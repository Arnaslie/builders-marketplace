"""Deterministic cart builder behind POST /agent/build-cart.

No LLM yet. The rules are plain code so the result is reproducible and testable; a later LLM
step can add explanations or extra swaps on top, but must not replace these guarantees.

1. Owned: every line whose id is in ``owned`` is left out (``skipped_line_ids``).
   Unknown ids are an error, so a frontend typo cannot silently buy a tool the user owns.
2. Budget: if a budget is given and the subtotal exceeds it, each remaining line's cheapest
   listed alternative becomes a swap candidate. Candidates are applied largest line saving
   first (ties broken by line id) until the subtotal fits. Biggest-first reaches the budget
   with the fewest substitutions, so the user keeps as many of the recommended products as
   possible. If every swap is applied and the cart still does not fit, the cart is returned
   with ``within_budget = false`` rather than dropping items the project needs.
"""

from dataclasses import dataclass
from decimal import Decimal

from .models import Cart, CartLine, MaterialLine, Project, ProductOption, Swap

CENT = Decimal("0.01")


class UnknownLineError(ValueError):
    def __init__(self, line_ids: list[str]) -> None:
        super().__init__(f"unknown material line ids: {', '.join(line_ids)}")
        self.line_ids = line_ids


def money(value: Decimal) -> str:
    return str(value.quantize(CENT))


def default_option(line: MaterialLine) -> ProductOption:
    return ProductOption(
        channel3_product_id=line.channel3_product_id,
        name=line.name,
        price=line.price,
        currency=line.currency,
        retailer=line.retailer,
        product_url=line.product_url,
        image_url=line.image_url,
    )


def line_total(line: MaterialLine) -> Decimal:
    return Decimal(line.price) * line.qty


def project_total(project: Project) -> Decimal:
    return sum((line_total(line) for line in project.materials), Decimal("0"))


def _cheapest_alternative(line: MaterialLine) -> ProductOption | None:
    cheaper = [
        alt
        for alt in line.alternatives
        if alt.currency == line.currency and Decimal(alt.price) < Decimal(line.price)
    ]
    return min(cheaper, key=lambda alt: (Decimal(alt.price), alt.name), default=None)


def build_cart(project: Project, owned: list[str], budget: str | None) -> Cart:
    known = {line.id for line in project.materials}
    unknown = sorted(set(owned) - known)
    if unknown:
        raise UnknownLineError(unknown)

    owned_ids = set(owned)
    kept = [line for line in project.materials if line.id not in owned_ids]
    skipped = [line.id for line in project.materials if line.id in owned_ids]

    chosen: dict[str, ProductOption] = {line.id: default_option(line) for line in kept}
    subtotal = sum((line_total(line) for line in kept), Decimal("0"))
    swaps: list[Swap] = []

    if budget is not None:
        limit = Decimal(budget)
        candidates: list[tuple[Decimal, MaterialLine, ProductOption]] = []
        for line in kept:
            alt = _cheapest_alternative(line)
            if alt is not None:
                candidates.append(((Decimal(line.price) - Decimal(alt.price)) * line.qty, line, alt))
        candidates.sort(key=lambda c: (-c[0], c[1].id))

        for saving, line, alt in candidates:
            if subtotal <= limit:
                break
            over = subtotal - limit
            subtotal -= saving
            chosen[line.id] = alt
            swaps.append(
                Swap(
                    line_id=line.id,
                    from_=default_option(line),
                    to=alt,
                    reason=(
                        f"Cart was {money(over)} {project.currency} over the {money(limit)} budget; "
                        f"{alt.name} from {alt.retailer} is the cheapest listed alternative "
                        f"and saves {money(saving)}."
                    ),
                    savings=money(saving),
                )
            )

    swapped_ids = {swap.line_id for swap in swaps}
    lines = [
        CartLine(
            line_id=line.id,
            name=chosen[line.id].name,
            category=line.category,
            qty=line.qty,
            unit_price=chosen[line.id].price,
            line_total=money(Decimal(chosen[line.id].price) * line.qty),
            currency=line.currency,
            retailer=chosen[line.id].retailer,
            product_url=chosen[line.id].product_url,
            channel3_product_id=chosen[line.id].channel3_product_id,
            swapped=line.id in swapped_ids,
        )
        for line in kept
    ]
    return Cart(
        project_id=project.id,
        currency=project.currency,
        lines=lines,
        swaps=swaps,
        skipped_line_ids=skipped,
        subtotal=money(subtotal),
        budget=budget,
        within_budget=budget is None or subtotal <= Decimal(budget),
    )


# --- Agent-proposed swaps -------------------------------------------------------------------
# app/agent.py lets an LLM choose which swaps to make, but every proposal is checked and priced
# here, so the totals still come from this file and never from model output.


class InvalidSwapError(ValueError):
    """A proposed swap breaks the cart rules; the caller drops it."""


@dataclass(frozen=True)
class SwapChoice:
    line_id: str
    alt_index: int  # position in MaterialLine.alternatives
    reason: str


def check_swap(
    project: Project, owned: list[str], line_id: str, alt_index: object
) -> tuple[MaterialLine, ProductOption]:
    """Return the line and its alternative, or raise InvalidSwapError.

    A swap must name a real line that is not owned, pick a listed alternative (so no invented
    product or price), stay in the line's currency, and be strictly cheaper than the default.
    """
    line = next((m for m in project.materials if m.id == line_id), None)
    if line is None:
        raise InvalidSwapError(f"unknown line {line_id!r}")
    if line_id in owned:
        raise InvalidSwapError(f"line {line_id!r} is owned, so it is not in the cart")
    if isinstance(alt_index, bool) or not isinstance(alt_index, int) or not 0 <= alt_index < len(line.alternatives):
        raise InvalidSwapError(f"line {line_id!r} has no alternative {alt_index!r}")
    alt = line.alternatives[alt_index]
    if alt.currency != line.currency or Decimal(alt.price) >= Decimal(line.price):
        raise InvalidSwapError(f"alternative {alt_index} of {line_id!r} is not cheaper")
    return line, alt


def build_cart_with_swaps(project: Project, owned: list[str], budget: str | None, choices: list[SwapChoice]) -> Cart:
    """The cart for ``owned`` with exactly ``choices`` applied (no budget-driven swaps of its own).

    Raises UnknownLineError for a bad owned id and InvalidSwapError for a bad or repeated choice.
    ``within_budget`` is computed, not trusted; the caller decides what to do when it is false.
    """
    base = build_cart(project, owned, None)
    picked: dict[str, tuple[SwapChoice, MaterialLine, ProductOption]] = {}
    for choice in choices:
        if choice.line_id in picked:
            raise InvalidSwapError(f"line {choice.line_id!r} swapped twice")
        line, alt = check_swap(project, owned, choice.line_id, choice.alt_index)
        picked[choice.line_id] = (choice, line, alt)

    lines: list[CartLine] = []
    swaps: list[Swap] = []
    for cart_line in base.lines:
        pick = picked.get(cart_line.line_id)
        if pick is None:
            lines.append(cart_line)
            continue
        choice, line, alt = pick
        swaps.append(
            Swap(
                line_id=line.id,
                from_=default_option(line),
                to=alt,
                reason=choice.reason,
                savings=money((Decimal(line.price) - Decimal(alt.price)) * line.qty),
            )
        )
        lines.append(
            cart_line.model_copy(
                update={
                    "name": alt.name,
                    "unit_price": alt.price,
                    "line_total": money(Decimal(alt.price) * line.qty),
                    "retailer": alt.retailer,
                    "product_url": alt.product_url,
                    "channel3_product_id": alt.channel3_product_id,
                    "swapped": True,
                    "reason": choice.reason,
                }
            )
        )
    subtotal = sum((Decimal(item.line_total) for item in lines), Decimal("0"))
    return base.model_copy(
        update={
            "lines": lines,
            "swaps": swaps,
            "subtotal": money(subtotal),
            "budget": budget,
            "within_budget": budget is None or subtotal <= Decimal(budget),
        }
    )
