"""PayPal Orders v2 REST client (sandbox unless PAYPAL_ENV=live).

The app is the merchant of record: the buyer pays our PayPal account for the whole cart, and the
per-retailer purchases are simulated. This module is the only code that talks to PayPal.

Docs this file follows (checked 2026-11-03):
  OAuth 2.0 client credentials:  https://developer.paypal.com/api/rest/authentication/
  Create order:                  https://developer.paypal.com/api/orders/v2/orders-create/
  Capture / show order:          https://developer.paypal.com/docs/api/orders/v2/
  Orders v2 error names:         https://developer.paypal.com/api/rest/reference/orders/v2/errors/
  PayPal-Request-Id idempotency: https://developer.paypal.com/api/rest/reference/idempotency/

Secrets: the client secret is read from the environment, sent only as HTTP Basic auth to the
token endpoint, and never put in an exception message, a log line or a repr. Errors carry only
PayPal's own error name, issue code and debug_id.
"""

import os
import re
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Literal

import httpx

from .cart import money
from .models import Cart

SANDBOX_URL = "https://api-m.sandbox.paypal.com"
LIVE_URL = "https://api-m.paypal.com"

# Refresh the token this many seconds before PayPal says it expires, so a call made just before
# expiry never reaches PayPal with a dead token.
TOKEN_REFRESH_MARGIN = 60.0
TIMEOUT = httpx.Timeout(15.0)
# Item names longer than this are truncated by PayPal (create-order reference, items[].name).
ITEM_NAME_MAX = 127
# PayPal order ids are uppercase alphanumerics. Checked before an id goes into a URL path.
ORDER_ID = re.compile(r"[A-Z0-9]{1,36}")

PayPalEnv = Literal["sandbox", "live"]


class PayPalError(Exception):
    """PayPal answered with an HTTP error. Holds PayPal's error codes only, never request data."""

    def __init__(self, status_code: int, name: str | None, issue: str | None, debug_id: str | None) -> None:
        self.status_code = status_code
        self.name = name
        self.issue = issue
        self.debug_id = debug_id
        super().__init__(f"PayPal HTTP {status_code} name={name} issue={issue} debug_id={debug_id}")


class PayPalUnavailable(Exception):
    """PayPal could not be reached, timed out, or sent a body we cannot read."""


@dataclass(frozen=True)
class PayPalConfig:
    client_id: str
    client_secret: str = field(repr=False)
    env: PayPalEnv = "sandbox"

    @property
    def base_url(self) -> str:
        return LIVE_URL if self.env == "live" else SANDBOX_URL

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> "PayPalConfig | None":
        """PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET, or None when either is missing.

        PAYPAL_ENV=live selects production; anything else (including unset) is sandbox, so a typo
        can never move real money.
        """
        client_id = environ.get("PAYPAL_CLIENT_ID", "").strip()
        client_secret = environ.get("PAYPAL_CLIENT_SECRET", "").strip()
        if not client_id or not client_secret:
            return None
        env: PayPalEnv = "live" if environ.get("PAYPAL_ENV", "").strip().lower() == "live" else "sandbox"
        return cls(client_id=client_id, client_secret=client_secret, env=env)


def order_request(cart: Cart, custom_id: str) -> dict[str, Any]:
    """The POST /v2/checkout/orders body for a server-built cart.

    One purchase unit with one item per cart line. PayPal rejects the order unless
    amount.value == breakdown.item_total (AMOUNT_MISMATCH) and item_total == sum of
    unit_amount x quantity (ITEM_TOTAL_MISMATCH), so both are derived from the same lines.
    """
    item_total = money(sum((Decimal(line.unit_price) * line.qty for line in cart.lines), Decimal("0")))
    if item_total != cart.subtotal:
        raise ValueError(f"cart lines sum to {item_total}, not the subtotal {cart.subtotal}")
    currency = cart.currency
    return {
        "intent": "CAPTURE",
        "purchase_units": [
            {
                "reference_id": cart.project_id,
                "custom_id": custom_id,  # our order id, so a PayPal dashboard row leads back to it
                "amount": {
                    "currency_code": currency,
                    "value": cart.subtotal,
                    "breakdown": {"item_total": {"currency_code": currency, "value": item_total}},
                },
                "items": [
                    {
                        "name": line.name[:ITEM_NAME_MAX],
                        "quantity": str(line.qty),
                        "unit_amount": {"currency_code": currency, "value": line.unit_price},
                        "sku": line.line_id,
                        "category": "PHYSICAL_GOODS",
                    }
                    for line in cart.lines
                ],
            }
        ],
    }


def first_capture(paypal_order: Mapping[str, Any]) -> Mapping[str, Any] | None:
    """purchase_units[0].payments.captures[0] of a capture or show-order response, if present."""
    try:
        capture = paypal_order["purchase_units"][0]["payments"]["captures"][0]
    except (KeyError, IndexError, TypeError):
        return None
    return capture if isinstance(capture, Mapping) else None


def approve_url(paypal_order: Mapping[str, Any]) -> str | None:
    for link in paypal_order.get("links") or []:
        if isinstance(link, Mapping) and link.get("rel") in ("approve", "payer-action"):
            href = link.get("href")
            return href if isinstance(href, str) else None
    return None


class PayPalClient:
    """Thread-safe: FastAPI runs these sync routes in a thread pool, so the token cache is locked."""

    def __init__(
        self,
        config: PayPalConfig,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.config = config
        self._http = httpx.Client(base_url=config.base_url, timeout=TIMEOUT, transport=transport)
        self._clock = clock
        self._lock = threading.Lock()
        self._token: str | None = None
        self._expires_at = 0.0

    @classmethod
    def from_env(cls) -> "PayPalClient | None":
        config = PayPalConfig.from_env()
        return cls(config) if config is not None else None

    # --- OAuth ------------------------------------------------------------------------------

    def access_token(self) -> str:
        """A cached bearer token; fetched again only when it is within TOKEN_REFRESH_MARGIN of expiry."""
        with self._lock:
            if self._token is not None and self._clock() < self._expires_at:
                return self._token
            body = self._send(
                "POST",
                "/v1/oauth2/token",
                auth=(self.config.client_id, self.config.client_secret),
                data={"grant_type": "client_credentials"},
                headers={"Accept": "application/json"},
            )
            token, expires_in = body.get("access_token"), body.get("expires_in")
            if not isinstance(token, str) or not isinstance(expires_in, int | float):
                raise PayPalUnavailable("token response has no access_token/expires_in")
            self._token = token
            self._expires_at = self._clock() + max(0.0, float(expires_in) - TOKEN_REFRESH_MARGIN)
            return token

    def _forget_token(self, token: str) -> None:
        with self._lock:
            if self._token == token:
                self._token = None

    # --- Orders v2 --------------------------------------------------------------------------

    def create_order(self, cart: Cart, custom_id: str) -> dict[str, Any]:
        return self._call("POST", "/v2/checkout/orders", json=order_request(cart, custom_id))

    def capture_order(self, order_id: str, request_id: str) -> dict[str, Any]:
        """Capture an approved order. ``request_id`` goes in PayPal-Request-Id: reuse the same value
        when retrying, and PayPal returns the earlier result instead of capturing twice."""
        return self._call(
            "POST", f"/v2/checkout/orders/{_checked_id(order_id)}/capture", headers={"PayPal-Request-Id": request_id}
        )

    def get_order(self, order_id: str) -> dict[str, Any]:
        return self._call("GET", f"/v2/checkout/orders/{_checked_id(order_id)}")

    # --- HTTP -------------------------------------------------------------------------------

    def _call(
        self, method: str, path: str, json: Any = None, headers: dict[str, str] | None = None, retried: bool = False
    ) -> dict[str, Any]:
        token = self.access_token()
        all_headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",  # full order back, including payments.captures
            **(headers or {}),
        }
        try:
            return self._send(method, path, json=json, headers=all_headers)
        except PayPalError as exc:
            # A token PayPal revoked early: drop it and try once more with a fresh one.
            if exc.status_code == 401 and not retried:
                self._forget_token(token)
                return self._call(method, path, json=json, headers=headers, retried=True)
            raise

    def _send(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        try:
            response = self._http.request(method, path, **kwargs)
        except httpx.HTTPError as exc:
            # Only the exception type: httpx messages can include the URL, never headers, but
            # keeping it minimal means nothing sensitive can ride along by accident.
            raise PayPalUnavailable(f"{method} {path}: {type(exc).__name__}") from None
        body = _json_object(response)
        if response.is_error:
            details = body.get("details")
            first = details[0] if isinstance(details, list) and details and isinstance(details[0], dict) else {}
            raise PayPalError(
                response.status_code,
                name=_str_or_none(body.get("name") or body.get("error")),  # Orders use name, OAuth uses error
                issue=_str_or_none(first.get("issue")),
                debug_id=_str_or_none(body.get("debug_id") or response.headers.get("PayPal-Debug-Id")),
            )
        if not body:
            raise PayPalUnavailable(f"{method} {path}: HTTP {response.status_code} with no JSON object body")
        return body

    def close(self) -> None:
        self._http.close()


def _checked_id(order_id: str) -> str:
    if not ORDER_ID.fullmatch(order_id):
        raise ValueError("not a PayPal order id")
    return order_id


def _json_object(response: httpx.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _str_or_none(value: Any) -> str | None:
    return value if isinstance(value, str) else None
