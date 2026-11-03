"""An in-memory stand-in for the PayPal sandbox REST API, served through httpx.MockTransport.

No network. It enforces the parts of PayPal's behaviour our code depends on: Basic auth on the
token endpoint, bearer tokens on Orders calls, AMOUNT_MISMATCH / ITEM_TOTAL_MISMATCH on create,
ORDER_NOT_APPROVED / ORDER_ALREADY_CAPTURED on capture, and PayPal-Request-Id replay.
"""

import base64
import json
import re
import secrets
import string
from decimal import Decimal
from typing import Any

import httpx

from app.paypal import PayPalClient, PayPalConfig

CLIENT_ID = "test-client-id"
CLIENT_SECRET = "test-client-secret-do-not-leak"
ORDER_PATH = re.compile(r"/v2/checkout/orders/([A-Z0-9]+)(/capture)?")


def _paypal_id() -> str:
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(17))


def _error(status: int, name: str, issue: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"name": name, "message": name, "debug_id": "dbg0001"}
    if issue:
        body["details"] = [{"issue": issue, "description": issue}]
    return httpx.Response(status, json=body)


class FakePayPal:
    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.orders: dict[str, dict[str, Any]] = {}
        self.capture_replies: dict[str, dict[str, Any]] = {}  # PayPal-Request-Id -> stored reply
        self.tokens: set[str] = set()
        self.token_calls = 0
        self.expires_in = 32400
        self.approve_on_create = True  # pretend the buyer approves in the popup
        self.approved: set[str] = set()
        self.capture_status = "COMPLETED"
        # Inject one failure into the next call of a kind: "token" | "create" | "capture" | "get".
        # Value: (status, name, issue) for an HTTP error, or "network" for a connection error.
        self.fail_next: dict[str, tuple[int, str, str | None] | str] = {}

    def client(self, clock: Any = None) -> PayPalClient:
        config = PayPalConfig(client_id=CLIENT_ID, client_secret=CLIENT_SECRET, env="sandbox")
        transport = httpx.MockTransport(self.handle)
        return PayPalClient(config, transport=transport, clock=clock) if clock else PayPalClient(config, transport=transport)

    def calls(self, kind: str) -> list[httpx.Request]:
        return [r for r in self.requests if _kind(r) == kind]

    def revoke_tokens(self) -> None:
        self.tokens.clear()

    # --- dispatch ---------------------------------------------------------------------------

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        kind = _kind(request)
        injected = self.fail_next.pop(kind, None)
        if injected == "network":
            raise httpx.ConnectError("connection refused", request=request)
        if isinstance(injected, tuple):
            return _error(*injected)
        if kind == "token":
            return self._token(request)
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth.removeprefix("Bearer ") not in self.tokens:
            return httpx.Response(401, json={"error": "invalid_token", "error_description": "Token is invalid"})
        if kind == "create":
            return self._create(request)
        match = ORDER_PATH.fullmatch(request.url.path)
        order = self.orders.get(match.group(1)) if match else None
        if order is None:
            return _error(404, "RESOURCE_NOT_FOUND", "INVALID_RESOURCE_ID")
        if kind == "capture":
            return self._capture(request, order)
        return httpx.Response(200, json=order)

    def _token(self, request: httpx.Request) -> httpx.Response:
        self.token_calls += 1
        expected = "Basic " + base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
        form = dict(pair.split("=", 1) for pair in request.content.decode().split("&") if pair)
        if request.headers.get("Authorization") != expected or form.get("grant_type") != "client_credentials":
            return httpx.Response(401, json={"error": "invalid_client", "error_description": "Client Authentication failed"})
        token = f"A21AA{secrets.token_hex(8)}"
        self.tokens.add(token)
        return httpx.Response(200, json={"access_token": token, "token_type": "Bearer", "expires_in": self.expires_in})

    def _create(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        unit = body["purchase_units"][0]
        amount = unit["amount"]
        item_total = Decimal(amount["breakdown"]["item_total"]["value"])
        if Decimal(amount["value"]) != item_total:
            return _error(422, "UNPROCESSABLE_ENTITY", "AMOUNT_MISMATCH")
        items_sum = sum(Decimal(i["unit_amount"]["value"]) * int(i["quantity"]) for i in unit["items"])
        if items_sum != item_total:
            return _error(422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_MISMATCH")
        paypal_id = _paypal_id()
        order = {
            "id": paypal_id,
            "intent": body["intent"],
            "status": "CREATED",
            "purchase_units": [{**unit, "reference_id": unit.get("reference_id", "default")}],
            "links": [
                {"href": f"https://api.sandbox.paypal.com/v2/checkout/orders/{paypal_id}", "rel": "self", "method": "GET"},
                {"href": f"https://www.sandbox.paypal.com/checkoutnow?token={paypal_id}", "rel": "approve", "method": "GET"},
                {"href": f"https://api.sandbox.paypal.com/v2/checkout/orders/{paypal_id}", "rel": "update", "method": "PATCH"},
                {"href": f"https://api.sandbox.paypal.com/v2/checkout/orders/{paypal_id}/capture", "rel": "capture", "method": "POST"},
            ],
        }
        self.orders[paypal_id] = order
        if self.approve_on_create:
            self.approved.add(paypal_id)
        return httpx.Response(201, json=order)

    def _capture(self, request: httpx.Request, order: dict[str, Any]) -> httpx.Response:
        request_id = request.headers.get("PayPal-Request-Id")
        if request_id and request_id in self.capture_replies:
            return httpx.Response(201, json=self.capture_replies[request_id])
        if order["status"] == "COMPLETED":
            return _error(422, "UNPROCESSABLE_ENTITY", "ORDER_ALREADY_CAPTURED")
        if order["id"] not in self.approved:
            return _error(422, "UNPROCESSABLE_ENTITY", "ORDER_NOT_APPROVED")
        self.capture(order["id"])
        if request_id:
            self.capture_replies[request_id] = order
        return httpx.Response(201, json=order)

    def capture(self, paypal_id: str) -> dict[str, Any]:
        """Mark an order captured on the PayPal side (also used to simulate an out-of-band capture)."""
        order = self.orders[paypal_id]
        order["status"] = "COMPLETED"
        unit = order["purchase_units"][0]
        unit["payments"] = {
            "captures": [
                {
                    "id": f"CAP{_paypal_id()[:14]}",
                    "status": self.capture_status,
                    "amount": {"currency_code": unit["amount"]["currency_code"], "value": unit["amount"]["value"]},
                    "final_capture": True,
                }
            ]
        }
        return order


def _kind(request: httpx.Request) -> str:
    path = request.url.path
    if path == "/v1/oauth2/token":
        return "token"
    if path == "/v2/checkout/orders" and request.method == "POST":
        return "create"
    if path.endswith("/capture"):
        return "capture"
    return "get"
