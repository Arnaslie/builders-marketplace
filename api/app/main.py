"""DIY Wikipedia API (FastAPI).

Run locally from api/:  uv run uvicorn app.main:app --reload --port 8000
Every route serves fixture data for now (contract/fixtures). Routes marked TODO(PAYMENTS
ENGINEER) return stubs in the PayPal Orders v2 shape and call nothing external.
"""

import logging
import os
import re
import secrets
import string
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware

from .cart import UnknownLineError, build_cart, money, project_total
from .models import (
    BuildCartRequest,
    Cart,
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
    return _cart_or_422(_project_or_404(store, body.project_id), body)


# --- Checkout (TODO(PAYMENTS ENGINEER): replace stubs with real PayPal sandbox calls) --------


def _fake_paypal_id() -> str:
    # PayPal order ids are 17 uppercase alphanumerics; the stub mimics that so UI code can't tell.
    return "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(17))


@router.post(
    "/checkout/orders",
    response_model=PayPalOrder,
    status_code=status.HTTP_201_CREATED,
    responses={**NOT_FOUND, 422: {"description": "Invalid body, unknown owned line id, or empty cart"}},
    tags=["checkout"],
    operation_id="createCheckoutOrder",
)
def create_checkout_order(body: BuildCartRequest, store: Store, orders: Orders) -> PayPalOrder:
    """Create a PayPal order for the cart the server builds from this request.

    The client sends the same input as /agent/build-cart, not prices: the server recomputes the
    cart, so a tampered browser cannot set its own total.

    TODO(PAYMENTS ENGINEER): call POST /v2/checkout/orders on the PayPal sandbox with an OAuth
    token from PAYPAL_CLIENT_ID/PAYPAL_CLIENT_SECRET and return PayPal's response.
    """
    cart = _cart_or_422(_project_or_404(store, body.project_id), body)
    if not cart.lines:
        raise HTTPException(UNPROCESSABLE, "cart is empty; nothing to pay for")
    paypal_id = _fake_paypal_id()
    orders[paypal_id] = Order(
        id=f"ord_{secrets.token_hex(6)}",
        paypal_order_id=paypal_id,
        paypal_capture_id=None,
        project_id=cart.project_id,
        status="created",
        fulfilment="simulated",
        total=cart.subtotal,
        currency=cart.currency,
        lines=cart.lines,
    )
    return PayPalOrder(
        id=paypal_id,
        intent="CAPTURE",
        status="CREATED",
        purchase_units=[
            PayPalPurchaseUnit(
                reference_id=cart.project_id,
                amount=PayPalAmount(currency_code=cart.currency, value=cart.subtotal),
            )
        ],
        links=[
            PayPalLink(href=f"https://www.sandbox.paypal.com/checkoutnow?token={paypal_id}", rel="approve", method="GET"),
            PayPalLink(href=f"/checkout/orders/{paypal_id}/capture", rel="capture", method="POST"),
        ],
    )


@router.post(
    "/checkout/orders/{order_id}/capture",
    response_model=Order,
    responses={**NOT_FOUND, 422: {"description": "Order already captured"}},
    tags=["checkout"],
    operation_id="captureCheckoutOrder",
)
def capture_checkout_order(order_id: str, orders: Orders) -> Order:
    """Capture an approved PayPal order and return our order record (fulfilment simulated).

    ``order_id`` is the PayPal order id (the JS SDK passes it to onApprove as ``data.orderID``).

    TODO(PAYMENTS ENGINEER): call POST /v2/checkout/orders/{id}/capture on the sandbox, store the
    capture id from purchase_units[0].payments.captures[0].id, and only then mark the order paid.
    """
    order = orders.get(order_id)
    if order is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"order {order_id!r} not found")
    if order.status == "paid":
        raise HTTPException(UNPROCESSABLE, "order already captured")
    paid = order.model_copy(update={"status": "paid", "paypal_capture_id": f"STUBCAPTURE{_fake_paypal_id()[:6]}"})
    orders[order_id] = paid
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
        description="Contract for issue #1. Fixture-backed; checkout routes are PayPal-shaped stubs.",
        # One schema per model (not Model-Input / Model-Output pairs) keeps generated TS names clean.
        separate_input_output_schemas=False,
    )
    app.state.store = FixtureStore.from_dir(fixtures or fixtures_dir())
    app.state.orders = {}
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins if cors_origins is not None else cors_origins_from_env(),
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    app.include_router(router)
    return app


app = create_app()
