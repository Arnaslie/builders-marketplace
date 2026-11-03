"""DIY Wikipedia API (FastAPI).

Run locally from api/:  uv run uvicorn app.main:app --reload --port 8000
Project and cart routes serve fixture data (contract/fixtures). Checkout routes call the PayPal
Orders v2 API (sandbox unless PAYPAL_ENV=live) through app/paypal.py.
"""

import logging
import os
import re
import secrets
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .agent import build_agent_cart
from .cart import UnknownLineError, build_cart, money, project_total
from .models import (
    BuildCartRequest,
    Cart,
    CheckoutConfig,
    Health,
    Order,
    PayPalAmount,
    PayPalLink,
    PayPalOrder,
    PayPalPurchaseUnit,
    Project,
    ProjectSummary,
    Recommendation,
    RecommendationRequest,
    WebhookAck,
)
from .paypal import PayPalClient, PayPalError, PayPalUnavailable, approve_url, first_capture
from .store import FixtureStore, fixtures_dir

# uvicorn configures its own "uvicorn.error" logger at INFO; reusing it means our lines show up in
# the server log (Render log stream, .verify/<run>/state/api.log) without extra logging setup.
log = logging.getLogger("uvicorn.error")

DEFAULT_CORS_ORIGINS = "http://localhost:3000"
NOT_FOUND = {404: {"description": "Not found"}}
# Literal 422: Starlette renamed the constant (UNPROCESSABLE_ENTITY -> UNPROCESSABLE_CONTENT).
UNPROCESSABLE = 422

router = APIRouter()


def cors_origins_from_env() -> list[str]:
    raw = os.environ.get("CORS_ALLOW_ORIGINS", DEFAULT_CORS_ORIGINS)
    return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]


def get_store(request: Request) -> FixtureStore:
    return request.app.state.store


def get_orders(request: Request) -> dict[str, Order]:
    return request.app.state.orders


Store = Annotated[FixtureStore, Depends(get_store)]
Orders = Annotated[dict[str, Order], Depends(get_orders)]


def _project_or_404(store: FixtureStore, project_id: str) -> Project:
    project = store.by_id(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"project {project_id!r} not found")
    return project


def _cart_or_422(project: Project, body: BuildCartRequest) -> Cart:
    try:
        return build_cart(project, body.owned, body.budget)
    except UnknownLineError as exc:
        raise HTTPException(UNPROCESSABLE, str(exc)) from exc


# --- Ops ------------------------------------------------------------------------------------


@router.get("/healthz", response_model=Health, tags=["ops"], operation_id="healthz")
def healthz() -> Health:
    return Health(status="ok")


# --- Projects -------------------------------------------------------------------------------


@router.get("/projects", response_model=list[ProjectSummary], tags=["projects"], operation_id="listProjects")
def list_projects(store: Store) -> list[ProjectSummary]:
    return [
        ProjectSummary(
            id=p.id,
            slug=p.slug,
            title=p.title,
            summary=p.summary,
            difficulty=p.difficulty,
            estimated_hours=p.estimated_hours,
            image_url=p.image_url,
            line_count=len(p.materials),
            estimated_total=money(project_total(p)),
            currency=p.currency,
        )
        for p in store.projects()
    ]


@router.get(
    "/projects/{slug}", response_model=Project, responses=NOT_FOUND, tags=["projects"], operation_id="getProject"
)
def get_project(slug: str, store: Store) -> Project:
    project = store.by_slug(slug)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"project {slug!r} not found")
    return project


@router.post(
    "/recommendations",
    response_model=Recommendation,
    status_code=status.HTTP_201_CREATED,
    tags=["projects"],
    operation_id="createRecommendation",
)
def create_recommendation(body: RecommendationRequest) -> Recommendation:
    # TODO(backend): persist drafts and add a review flow; today the draft is echoed, not stored.
    slug = re.sub(r"[^a-z0-9]+", "-", body.title.lower()).strip("-")
    return Recommendation(
        id=f"rec_{secrets.token_hex(6)}",
        status="draft",
        slug=slug,
        title=body.title,
        summary=body.summary,
        steps=body.steps,
        materials=body.materials,
        created_at=datetime.now(UTC),
    )


# --- Shopping agent -------------------------------------------------------------------------


@router.post(
    "/agent/build-cart",
    response_model=Cart,
    responses={**NOT_FOUND, 422: {"description": "Invalid body or unknown owned line id"}},
    tags=["agent"],
    operation_id="buildCart",
)
def agent_build_cart(body: BuildCartRequest, store: Store) -> Cart:
    project = _project_or_404(store, body.project_id)
    try:
        return build_agent_cart(project, body.owned, body.budget)
    except UnknownLineError as exc:
        raise HTTPException(UNPROCESSABLE, str(exc)) from exc


# --- Checkout: PayPal Orders v2 (app is merchant of record; fulfilment simulated) -----------

# Every fixture project is priced in USD; the JS SDK script tag must use the same currency.
CHECKOUT_CURRENCY = "USD"
PAYPAL_CREATED_STATUSES = {"CREATED", "APPROVED", "COMPLETED"}
# One capture at a time, so a double-clicked Pay button cannot send two captures for one order.
_capture_lock = threading.Lock()


def get_paypal(request: Request) -> PayPalClient:
    paypal = request.app.state.paypal
    if paypal is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "PayPal is not configured on this server (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET unset)",
        )
    return paypal


PayPal = Annotated[PayPalClient, Depends(get_paypal)]


def _paypal_http_error(exc: PayPalError | PayPalUnavailable, action: str) -> HTTPException:
    """Translate a PayPal failure into our API error. Logs PayPal's codes only, never bodies."""
    if isinstance(exc, PayPalUnavailable):
        log.warning("paypal %s failed: %s", action, exc)
        return HTTPException(status.HTTP_502_BAD_GATEWAY, f"PayPal {action} failed: PayPal did not respond")
    log.warning(
        "paypal %s failed: http=%s name=%s issue=%s debug_id=%s",
        action, exc.status_code, exc.name, exc.issue, exc.debug_id,
    )
    # The two buyer-side outcomes the frontend can act on get their own status codes.
    if exc.issue == "INSTRUMENT_DECLINED":
        return HTTPException(
            status.HTTP_402_PAYMENT_REQUIRED, "INSTRUMENT_DECLINED: the funding source was declined; choose another"
        )
    if exc.issue == "ORDER_NOT_APPROVED":
        return HTTPException(status.HTTP_409_CONFLICT, "ORDER_NOT_APPROVED: the buyer has not approved this order")
    return HTTPException(
        status.HTTP_502_BAD_GATEWAY,
        f"PayPal {action} failed ({exc.name or f'HTTP {exc.status_code}'}, debug_id {exc.debug_id or 'none'})",
    )


@router.get(
    "/checkout/config",
    response_model=CheckoutConfig,
    responses={503: {"description": "PayPal credentials are not set on the server"}},
    tags=["checkout"],
    operation_id="getCheckoutConfig",
)
def get_checkout_config(paypal: PayPal) -> CheckoutConfig:
    """Public settings for the PayPal JS SDK script tag. Never includes the client secret."""
    return CheckoutConfig(client_id=paypal.config.client_id, currency=CHECKOUT_CURRENCY, env=paypal.config.env)


@router.post(
    "/checkout/orders",
    response_model=PayPalOrder,
    status_code=status.HTTP_201_CREATED,
    responses={
        **NOT_FOUND,
        422: {"description": "Invalid body, unknown owned line id, or empty cart"},
        502: {"description": "PayPal rejected the request or did not respond; no order was stored"},
        503: {"description": "PayPal credentials are not set on the server"},
    },
    tags=["checkout"],
    operation_id="createCheckoutOrder",
)
def create_checkout_order(body: BuildCartRequest, store: Store, orders: Orders, paypal: PayPal) -> PayPalOrder:
    """Create a PayPal order for the cart the server builds from this request.

    The client sends the same input as /agent/build-cart, not prices: the server recomputes the
    cart, so a tampered browser cannot set its own total.
    """
    cart = _cart_or_422(_project_or_404(store, body.project_id), body)
    if not cart.lines:
        raise HTTPException(UNPROCESSABLE, "cart is empty; nothing to pay for")
    our_id = f"ord_{secrets.token_hex(6)}"
    try:
        created = paypal.create_order(cart, custom_id=our_id)
    except (PayPalError, PayPalUnavailable) as exc:
        raise _paypal_http_error(exc, "create order") from None
    paypal_id, paypal_status, approve = created.get("id"), created.get("status"), approve_url(created)
    if not isinstance(paypal_id, str) or paypal_status not in PAYPAL_CREATED_STATUSES or approve is None:
        log.warning("paypal create order: unexpected response status=%s", paypal_status)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "PayPal create order returned an unexpected response")
    orders[paypal_id] = Order(
        id=our_id,
        paypal_order_id=paypal_id,
        paypal_capture_id=None,
        project_id=cart.project_id,
        status="created",
        fulfilment="simulated",
        total=cart.subtotal,
        currency=cart.currency,
        lines=cart.lines,
    )
    log.info("paypal order created: paypal_id=%s order=%s total=%s %s", paypal_id, our_id, cart.subtotal, cart.currency)
    return PayPalOrder(
        id=paypal_id,
        intent="CAPTURE",
        status=paypal_status,
        purchase_units=[
            PayPalPurchaseUnit(
                reference_id=cart.project_id,
                amount=PayPalAmount(currency_code=cart.currency, value=cart.subtotal),
            )
        ],
        # PayPal's approve link, plus OUR capture route: PayPal's own capture link needs the
        # server's bearer token, so it is no use to a browser.
        links=[
            PayPalLink(href=approve, rel="approve", method="GET"),
            PayPalLink(href=f"/checkout/orders/{paypal_id}/capture", rel="capture", method="POST"),
        ],
    )


@router.get(
    "/checkout/orders/{order_id}",
    response_model=Order,
    responses=NOT_FOUND,
    tags=["checkout"],
    operation_id="getCheckoutOrder",
)
def get_checkout_order(order_id: str, orders: Orders) -> Order:
    """Our order record, by PayPal order id (for the confirmation page). Memory only: an API
    restart forgets it."""
    order = orders.get(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"order {order_id!r} not found")
    return order


@router.post(
    "/checkout/orders/{order_id}/capture",
    response_model=Order,
    responses={
        **NOT_FOUND,
        402: {"description": "INSTRUMENT_DECLINED: restart the PayPal flow so the buyer picks another source"},
        409: {"description": "Buyer has not approved the order, or the capture is not COMPLETED (not marked paid)"},
        502: {"description": "PayPal rejected the capture or did not respond; the order is not marked paid"},
        503: {"description": "PayPal credentials are not set on the server"},
    },
    tags=["checkout"],
    operation_id="captureCheckoutOrder",
)
def capture_checkout_order(order_id: str, orders: Orders, paypal: PayPal) -> Order:
    """Capture an approved PayPal order and return our order record (fulfilment simulated).

    ``order_id`` is the PayPal order id (the JS SDK passes it to onApprove as ``data.orderID``).
    Idempotent: capturing a paid order returns the stored record without calling PayPal again.
    The order is marked paid only when PayPal reports the capture COMPLETED.
    """
    if order_id not in orders:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"order {order_id!r} not found")
    with _capture_lock:
        order = orders[order_id]
        if order.status == "paid":
            return order
        try:
            # A fixed request id per order: a retry after a timeout returns PayPal's first result.
            result = paypal.capture_order(order_id, request_id=f"capture-{order.id}")
        except PayPalError as exc:
            if exc.issue != "ORDER_ALREADY_CAPTURED":
                raise _paypal_http_error(exc, "capture") from None
            # Captured already (e.g. an earlier attempt timed out after PayPal finished): read it back.
            try:
                result = paypal.get_order(order_id)
            except (PayPalError, PayPalUnavailable) as read_exc:
                raise _paypal_http_error(read_exc, "read order") from None
        except PayPalUnavailable as exc:
            raise _paypal_http_error(exc, "capture") from None

        capture = first_capture(result)
        capture_id = capture.get("id") if capture else None
        if not isinstance(capture_id, str):
            log.warning("paypal capture: no capture in response for paypal_id=%s", order_id)
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, "PayPal capture returned no capture record")
        capture_status = capture.get("status") if capture else None
        if capture_status != "COMPLETED":
            orders[order_id] = order.model_copy(update={"paypal_capture_id": capture_id})
            log.warning("paypal capture not completed: paypal_id=%s capture=%s status=%s", order_id, capture_id, capture_status)
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"PayPal capture {capture_id} is {capture_status}; the order is not marked paid"
            )
        paid = order.model_copy(update={"status": "paid", "paypal_capture_id": capture_id})
        orders[order_id] = paid
        log.info("paypal order captured: paypal_id=%s capture=%s order=%s", order_id, capture_id, order.id)
        return paid


@router.post("/webhooks/paypal", response_model=WebhookAck, tags=["checkout"], operation_id="paypalWebhook")
def paypal_webhook(event: Annotated[dict[str, Any], Body()]) -> WebhookAck:
    """Accept a PayPal webhook event and log it.

    TODO(PAYMENTS ENGINEER): verify the signature (POST /v1/notifications/verify-webhook-signature)
    before trusting the event, and handle PAYMENT.CAPTURE.COMPLETED / DENIED.
    """
    log.info("paypal webhook received: event_type=%s id=%s", event.get("event_type"), event.get("id"))
    return WebhookAck(received=True)


# --- App factory ----------------------------------------------------------------------------


def create_app(cors_origins: list[str] | None = None, fixtures: Path | None = None) -> FastAPI:
    app = FastAPI(
        title="DIY Wikipedia API",
        version="0.1.0",
        description="Contract for issue #1. Fixture-backed catalogue; checkout calls PayPal Orders v2.",
        # One schema per model (not Model-Input / Model-Output pairs) keeps generated TS names clean.
        separate_input_output_schemas=False,
    )
    app.state.store = FixtureStore.from_dir(fixtures or fixtures_dir())
    app.state.orders = {}
    # None when PAYPAL_CLIENT_ID/SECRET are unset: checkout routes then answer 503. Tests replace it.
    app.state.paypal = PayPalClient.from_env()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins is not None else cors_origins_from_env(),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
