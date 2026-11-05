"""Claude shopping agent behind POST /agent/build-cart (issues #12 / #5).

Division of labour: the model decides WHICH lines to swap and says why; app/cart.py decides
whether a swap is legal and computes every price and total. Nothing the model writes is trusted
as data. Each proposal must name a real, unowned line and one of that line's listed alternatives
(by index), be cheaper, and the finished cart must fit the budget. A proposal that fails is
dropped. If no key is set, the call fails or times out, nothing valid comes back, or the cart
would not fit the budget, the plain deterministic cart from build_cart is returned unchanged
(``agent_used`` false) so the endpoint never gets worse than before.

The model is only called when it has a decision to make: a budget is set and the cart is over it.

Anthropic docs this follows:
  Tool use overview / round trip:  https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
  Handling tool_use / tool_result: https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
  Python SDK (timeout, max_retries): https://platform.claude.com/docs/en/api/sdks/python
  Model ids:                       https://platform.claude.com/docs/en/about-claude/models/overview

Env: LLM_API_KEY (Anthropic key), LLM_MODEL (default below), LLM_TIMEOUT_SECONDS (whole call).
"""

import json
import logging
import os
import re
import time
from decimal import Decimal
from typing import Any

from .cart import InvalidSwapError, SwapChoice, build_cart, build_cart_with_swaps, check_swap, line_total
from .models import Cart, MaterialLine, Project

log = logging.getLogger("uvicorn.error")

# Models overview: "Claude Sonnet 5.5 ... the best combination of speed and intelligence".
# A request waits on this call, so speed matters; override with LLM_MODEL.
DEFAULT_MODEL = "claude-sonnet-5-5"
DEFAULT_TIMEOUT_SECONDS = 30.0
MAX_TURNS = 6  # lookup rounds before the model must have called submit_swaps
MAX_REASON_CHARS = 300

SYSTEM = (
    "You are the shopping agent for a DIY project site. The user wants to build a project within a "
    "budget but the cart is over it. Choose which lines to swap to a cheaper listed alternative so "
    "the cart fits, keeping as much of the recommended gear as you can: prefer swapping where the "
    "cheaper product still does the job. Use get_line_details and list_alternatives to look "
    "things up; they only know this project's lines. You can only pick an alternative by its index "
    "from list_alternatives; you cannot invent products or prices. Finish by calling submit_swaps "
    "exactly once, with a one-sentence reason per swap that the user will read. Swap nothing you "
    "do not need to."
)

TOOLS: list[dict[str, Any]] = [
    {
        "name": "get_line_details",
        "description": "Details of one cart line: name, category, qty, unit price, line total, retailer.",
        "input_schema": {
            "type": "object",
            "properties": {"line_id": {"type": "string"}},
            "required": ["line_id"],
        },
    },
    {
        "name": "list_alternatives",
        "description": (
            "Cheaper listed alternatives for one cart line, each with an index, unit price and the "
            "saving on the whole line. Empty when the line has none."
        ),
        "input_schema": {
            "type": "object",
            "properties": {"line_id": {"type": "string"}},
            "required": ["line_id"],
        },
    },
    {
        "name": "submit_swaps",
        "description": "Your final answer: the swaps to apply. An empty list means swap nothing.",
        "input_schema": {
            "type": "object",
            "properties": {
                "swaps": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "line_id": {"type": "string"},
                            "alternative_index": {"type": "integer"},
                            "reason": {"type": "string", "description": "One sentence for the user."},
                        },
                        "required": ["line_id", "alternative_index", "reason"],
                    },
                }
            },
            "required": ["swaps"],
        },
    },
]


class AgentError(RuntimeError):
    """The model run ended without a usable submit_swaps."""


def make_client() -> Any | None:
    """An Anthropic client from LLM_API_KEY, or None when no key is configured."""
    key = os.environ.get("LLM_API_KEY", "").strip()
    if not key:
        return None
    import anthropic  # imported here so the API still boots (and tests run) without the SDK call path

    # max_retries=0: the SDK retries twice by default, which could triple the wait; we fall back instead.
    return anthropic.Anthropic(api_key=key, timeout=_timeout_seconds(), max_retries=0)


def _timeout_seconds() -> float:
    try:
        return float(os.environ.get("LLM_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


_KEYLIKE = re.compile(r"sk-[A-Za-z0-9_\-]{6,}")
MAX_ERROR_LOG_CHARS = 300


def llm_status(exc: BaseException) -> int | None:
    """The provider's HTTP status for an SDK APIStatusError (400, 401, 429, ...), else None."""
    status = getattr(exc, "status_code", None)
    return status if isinstance(status, int) else None


def describe_llm_error(exc: BaseException) -> str:
    """One log-safe line naming what the provider said, e.g. 'BadRequestError 400: <message>'.

    For server logs only, never a response body. Anthropic's error message is the only way to tell
    a bad model id, a rejected parameter or an empty credit balance apart; key-like tokens are
    redacted and the text is truncated.
    """
    message = ""
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        error = body.get("error")
        if isinstance(error, dict) and isinstance(error.get("message"), str):
            message = error["message"]
    if not message:
        message = str(getattr(exc, "message", "") or exc)
    message = _KEYLIKE.sub("sk-***", " ".join(message.split()))[:MAX_ERROR_LOG_CHARS]
    status = llm_status(exc)
    head = type(exc).__name__ + (f" {status}" if status is not None else "")
    return f"{head}: {message}" if message else head


def _alternatives(line: MaterialLine) -> list[dict[str, Any]]:
    rows = []
    for index, alt in enumerate(line.alternatives):
        if alt.currency == line.currency and Decimal(alt.price) < Decimal(line.price):
            rows.append(
                {
                    "index": index,
                    "name": alt.name,
                    "unit_price": alt.price,
                    "retailer": alt.retailer,
                    "line_saving": str((Decimal(line.price) - Decimal(alt.price)) * line.qty),
                }
            )
    return rows


def _line_summary(line: MaterialLine) -> dict[str, Any]:
    return {
        "line_id": line.id,
        "name": line.name,
        "category": line.category,
        "qty": line.qty,
        "unit_price": line.price,
        "line_total": str(line_total(line)),
        "retailer": line.retailer,
    }


def _run_lookup(name: str, args: dict[str, Any], kept: dict[str, MaterialLine]) -> str:
    line = kept.get(str(args.get("line_id")))
    if line is None:
        raise KeyError(f"no such line in this cart: {args.get('line_id')!r}")
    if name == "get_line_details":
        return json.dumps({**_line_summary(line), "alternative_count": len(_alternatives(line))})
    return json.dumps(_alternatives(line))


def _tool_result(tool_use_id: str, content: str, is_error: bool = False) -> dict[str, Any]:
    block: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if is_error:
        block["is_error"] = True
    return block


def propose_swaps(client: Any, model: str, project: Project, owned: list[str], budget: str, subtotal: str) -> list[Any]:
    """Run the tool-use loop and return the raw ``swaps`` list the model submitted (unvalidated)."""
    kept = {m.id: m for m in project.materials if m.id not in set(owned)}
    brief = {
        "project": project.title,
        "currency": project.currency,
        "budget": budget,
        "cart_total_without_swaps": subtotal,
        "lines": [{**_line_summary(m), "alternative_count": len(_alternatives(m))} for m in kept.values()],
    }
    messages: list[dict[str, Any]] = [{"role": "user", "content": json.dumps(brief)}]
    deadline = time.monotonic() + _timeout_seconds()

    for _ in range(MAX_TURNS):
        if time.monotonic() > deadline:
            raise TimeoutError("agent exceeded LLM_TIMEOUT_SECONDS")
        response = client.messages.create(
            model=model, max_tokens=4096, system=SYSTEM, tools=TOOLS, messages=messages
        )
        if response.stop_reason != "tool_use":
            raise AgentError(f"model stopped with {response.stop_reason!r} before submit_swaps")

        results: list[dict[str, Any]] = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            if block.name == "submit_swaps":
                swaps = (block.input or {}).get("swaps")
                if not isinstance(swaps, list):
                    raise AgentError("submit_swaps without a swaps list")
                return swaps
            if block.name in ("get_line_details", "list_alternatives"):
                try:
                    results.append(_tool_result(block.id, _run_lookup(block.name, block.input or {}, kept)))
                except KeyError as exc:
                    results.append(_tool_result(block.id, str(exc.args[0]), is_error=True))
            else:
                results.append(_tool_result(block.id, f"unknown tool {block.name!r}", is_error=True))
        if not results:
            raise AgentError("tool_use stop with no tool_use block")
        # Docs: tool_result blocks go in the very next user message, answering every tool_use id.
        messages.append({"role": "assistant", "content": response.content})
        messages.append({"role": "user", "content": results})
    raise AgentError("no submit_swaps within the turn limit")


def validate_proposals(project: Project, owned: list[str], raw: list[Any]) -> list[SwapChoice]:
    """Keep only proposals that pass cart.check_swap; drop the rest (and repeats of a line)."""
    choices: list[SwapChoice] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        line_id, index, reason = item.get("line_id"), item.get("alternative_index"), item.get("reason")
        if not isinstance(line_id, str) or not isinstance(reason, str) or not reason.strip() or line_id in seen:
            continue
        try:
            check_swap(project, owned, line_id, index)
        except InvalidSwapError as exc:
            log.info("agent proposal dropped: %s", exc)
            continue
        seen.add(line_id)
        choices.append(SwapChoice(line_id=line_id, alt_index=index, reason=reason.strip()[:MAX_REASON_CHARS]))
    return choices


def build_agent_cart(project: Project, owned: list[str], budget: str | None) -> Cart:
    """The cart for POST /agent/build-cart. Raises UnknownLineError for a bad owned id."""
    baseline = build_cart(project, owned, budget)
    if budget is None or not baseline.swaps:
        return baseline  # nothing to decide: no budget, already within it, or no cheaper option exists

    client = make_client()
    if client is None:
        log.warning("agent skipped: LLM_API_KEY is not set; using the deterministic cart")
        return baseline

    model = os.environ.get("LLM_MODEL", "").strip() or DEFAULT_MODEL
    try:
        full = build_cart(project, owned, None)
        raw = propose_swaps(client, model, project, owned, budget, full.subtotal)
        choices = validate_proposals(project, owned, raw)
        if not choices:
            log.warning("agent returned no valid swaps; using the deterministic cart")
            return baseline
        cart = build_cart_with_swaps(project, owned, budget, choices)
    except Exception as exc:  # any SDK, network, timeout or protocol failure falls back
        log.warning("agent failed (%s); using the deterministic cart", describe_llm_error(exc))
        return baseline

    if not cart.within_budget:
        log.warning("agent cart is over budget; using the deterministic cart")
        return baseline
    return cart.model_copy(update={"agent_used": True})
