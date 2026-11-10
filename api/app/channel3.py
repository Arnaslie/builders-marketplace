"""Channel3 product search client (issues #11, #4).

Docs this file follows (checked 2026-11-03):
  Search API reference:  https://channel3.mintlify.dev/docs/api-reference/v1/search.md
  Auth header example:   https://channel3.mintlify.dev/docs/guides/make-a-search.md
  Search response shape: https://channel3.mintlify.dev/docs/guides/response-overview.md
  Offer:                 https://channel3.mintlify.dev/docs/guides/offer.md
  Pricing (1 credit per /v1/search call): https://channel3.mintlify.dev/docs/pricing.md

    POST https://api.trychannel3.com/v1/search
    x-api-key: <CHANNEL3_API_KEY>
    {"query": "...", "limit": 5, "config": {"country": "US", "currency": "USD"}}
    -> {"products": [Product], "next_page_token": str | null}

Price and buy link live on each offer, not on the product: product.offers[].price.price (the
Price schema in the API reference). The Offer guide's example shows price.amount instead, so the
parser accepts either.

Every call costs a credit, and the project has a fixed budget. So nothing here retries: a failed
call raises and the caller decides. The API key is held privately and never appears in errors,
logs or repr().

Uses urllib from the standard library instead of an HTTP package so the API service gains no
dependency; tests inject a fake ``send``.
"""

import json
import logging
import os
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

log = logging.getLogger(__name__)

API_BASE = "https://api.trychannel3.com"
SEARCH_PATH = "/v1/search"
ENV_KEY = "CHANNEL3_API_KEY"
DEFAULT_TIMEOUT = 20.0  # seconds; search p50 is ~800 ms per trychannel3.com/developers
MAX_LIMIT = 30  # documented maximum for SearchRequest.limit
USER_AGENT = "builders-marketplace-api/0.1 (+https://github.com/Arnaslie/builders-marketplace)"

# send(request, timeout) -> (status code, response body). HTTP errors are returned, not raised.
Send = Callable[[urllib.request.Request, float], tuple[int, bytes]]


class Channel3Error(RuntimeError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class Channel3AuthError(Channel3Error):
    """401 (missing or bad key) or 402 (out of credits): every further call will fail too."""


@dataclass(frozen=True)
class Offer:
    url: str
    domain: str
    price: Decimal
    currency: str
    availability: str
    condition: str | None


@dataclass(frozen=True)
class Product:
    id: str
    title: str
    image_url: str | None
    offers: tuple[Offer, ...]


def _urllib_send(request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        # str(exc) is the reason ("timed out", DNS failure); it never contains request headers.
        raise Channel3Error(f"network error calling Channel3: {exc}") from None


def _detail(body: bytes) -> str:
    """Channel3's error body is {"detail": str | list}; keep it short for logs."""
    try:
        detail: Any = json.loads(body).get("detail", "")
    except (ValueError, AttributeError):
        detail = body[:200].decode("utf-8", "replace")
    return str(detail)[:300]


def _parse_offer(raw: dict[str, Any]) -> Offer | None:
    price = raw.get("price") or {}
    amount = price.get("price", price.get("amount"))
    if amount is None or not raw.get("url") or not price.get("currency"):
        return None
    try:
        value = Decimal(str(amount))
    except InvalidOperation:
        return None
    return Offer(
        url=raw["url"],
        domain=raw.get("domain") or "",
        price=value,
        currency=str(price["currency"]).upper(),
        availability=raw.get("availability") or "InStock",  # docs: no data counts as InStock
        condition=raw.get("condition"),
    )


def _image_url(images: list[dict[str, Any]]) -> str | None:
    """Main image first; cleaned_url (square, background removed) is the docs' pick for grids."""
    if not images:
        return None
    main = next((img for img in images if img.get("is_main_image")), images[0])
    return main.get("cleaned_url") or main.get("url")


def parse_search_response(payload: dict[str, Any]) -> list[Product]:
    products = []
    for raw in payload.get("products") or []:
        if not raw.get("id") or not raw.get("title"):
            continue
        offers = tuple(o for o in (_parse_offer(r) for r in raw.get("offers") or []) if o is not None)
        products.append(
            Product(id=raw["id"], title=raw["title"], image_url=_image_url(raw.get("images") or []), offers=offers)
        )
    return products


class Channel3Client:
    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = API_BASE,
        timeout: float = DEFAULT_TIMEOUT,
        send: Send = _urllib_send,
    ) -> None:
        if not api_key:
            raise ValueError("api_key is empty")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._send = send

    @classmethod
    def from_env(cls, **kwargs: Any) -> "Channel3Client":
        key = os.environ.get(ENV_KEY, "").strip()
        if not key:
            raise Channel3Error(f"{ENV_KEY} is not set")
        return cls(key, **kwargs)

    def __repr__(self) -> str:
        return f"Channel3Client(base_url={self._base_url!r}, timeout={self._timeout})"

    def search(self, query: str, *, limit: int = 5, country: str = "US", currency: str = "USD") -> list[Product]:
        """One /v1/search call (1 credit). Returns products in Channel3's ranking order.

        Default filters are left on: new condition and in-stock offers only.
        """
        body = {
            "query": query,
            "limit": max(1, min(limit, MAX_LIMIT)),
            "config": {"country": country, "currency": currency},
        }
        request = urllib.request.Request(
            self._base_url + SEARCH_PATH,
            data=json.dumps(body).encode("utf-8"),
            method="POST",
            headers={
                "x-api-key": self._api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": USER_AGENT,
            },
        )
        status, raw = self._send(request, self._timeout)
        log.info("channel3 search status=%s query=%r", status, query)
        if status in (401, 402):
            raise Channel3AuthError(f"Channel3 {status}: {_detail(raw)}", status)
        if status != 200:
            raise Channel3Error(f"Channel3 {status}: {_detail(raw)}", status)
        try:
            payload = json.loads(raw)
        except ValueError as exc:
            raise Channel3Error("Channel3 returned a non-JSON body", status) from exc
        return parse_search_response(payload)
