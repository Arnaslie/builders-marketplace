"""PayPal Orders v2 client and checkout routes, against the in-memory fake (tests/fake_paypal.py).

No test here touches the network. The live sandbox is exercised by the verification skill.
"""

import json
import logging

import pytest
from fastapi.testclient import TestClient

from app.cart import build_cart
from app.main import create_app
from app.paypal import (
    LIVE_URL,
    SANDBOX_URL,
    PayPalConfig,
    PayPalError,
    PayPalUnavailable,
    first_capture,
)
from app.store import FixtureStore, fixtures_dir
from tests.fake_paypal import CLIENT_ID, CLIENT_SECRET, FakePayPal

CHAIR_ID = "proj-chair"
CHAIR_OWNED_DEFAULT = ["chair-drill", "chair-tape-measure", "chair-safety-glasses"]
CHAIR_BODY = {"projectId": CHAIR_ID, "owned": CHAIR_OWNED_DEFAULT}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def chair_cart(budget: str | None = None):
    project = FixtureStore.from_dir(fixtures_dir()).by_id(CHAIR_ID)
    assert project is not None
    return build_cart(project, CHAIR_OWNED_DEFAULT, budget)


# --- Config ---------------------------------------------------------------------------------


def test_config_from_env_requires_both_credentials() -> None:
    assert PayPalConfig.from_env({}) is None
    assert PayPalConfig.from_env({"PAYPAL_CLIENT_ID": "id"}) is None
    assert PayPalConfig.from_env({"PAYPAL_CLIENT_SECRET": "s"}) is None


def test_config_defaults_to_sandbox_and_only_live_means_live() -> None:
    env = {"PAYPAL_CLIENT_ID": "id", "PAYPAL_CLIENT_SECRET": "s"}
    assert PayPalConfig.from_env(env).base_url == SANDBOX_URL
    assert PayPalConfig.from_env({**env, "PAYPAL_ENV": "sandbox"}).env == "sandbox"
    assert PayPalConfig.from_env({**env, "PAYPAL_ENV": "production"}).env == "sandbox"
    live = PayPalConfig.from_env({**env, "PAYPAL_ENV": "live"})
    assert live.env == "live" and live.base_url == LIVE_URL


def test_config_repr_hides_secret() -> None:
    assert CLIENT_SECRET not in repr(PayPalConfig(client_id=CLIENT_ID, client_secret=CLIENT_SECRET))


# --- OAuth token caching --------------------------------------------------------------------


def test_token_is_cached_until_near_expiry() -> None:
    fake, clock = FakePayPal(), Clock()
    paypal = fake.client(clock=clock)
    fake.expires_in = 3600

    first = paypal.access_token()
    clock.now += 3600 - 61  # still more than the 60 s margin left
    assert paypal.access_token() == first
    assert fake.token_calls == 1

    clock.now += 2  # now inside the margin: refresh
    assert paypal.access_token() != first
    assert fake.token_calls == 2


def test_token_request_uses_basic_auth_and_client_credentials() -> None:
    fake = FakePayPal()
    fake.client().access_token()
    (request,) = fake.calls("token")
    assert request.method == "POST"
    assert request.url.host == "api-m.sandbox.paypal.com"
    assert request.headers["Authorization"].startswith("Basic ")
    assert request.content == b"grant_type=client_credentials"


def test_orders_calls_reuse_one_token() -> None:
    fake = FakePayPal()
    paypal = fake.client()
    paypal.create_order(chair_cart(), custom_id="ord_1")
    paypal.create_order(chair_cart(), custom_id="ord_2")
    assert fake.token_calls == 1
    assert all(r.headers["Authorization"].startswith("Bearer ") for r in fake.calls("create"))


def test_revoked_token_is_refreshed_once_and_retried() -> None:
    fake = FakePayPal()
    paypal = fake.client()
    paypal.access_token()
    fake.revoke_tokens()
    created = paypal.create_order(chair_cart(), custom_id="ord_1")
    assert created["status"] == "CREATED"
    assert fake.token_calls == 2
    assert len(fake.calls("create")) == 2


def test_bad_credentials_raise_paypal_error_without_secret() -> None:
    fake = FakePayPal()
    fake.fail_next["token"] = (401, "invalid_client", None)
    with pytest.raises(PayPalError) as info:
        fake.client().access_token()
    assert info.value.status_code == 401
    assert CLIENT_SECRET not in str(info.value)


# --- Create / capture requests --------------------------------------------------------------


def test_create_order_body_matches_server_cart() -> None:
    fake = FakePayPal()
    cart = chair_cart(budget="200.00")  # includes a swap, so unit prices differ from the defaults
    fake.client().create_order(cart, custom_id="ord_abc")
    (request,) = fake.calls("create")
    body = json.loads(request.content)
    assert request.headers["Prefer"] == "return=representation"
    assert body["intent"] == "CAPTURE"
    (unit,) = body["purchase_units"]
    assert unit["reference_id"] == CHAIR_ID
    assert unit["custom_id"] == "ord_abc"
    assert unit["amount"] == {
        "currency_code": "USD",
        "value": cart.subtotal,
        "breakdown": {"item_total": {"currency_code": "USD", "value": cart.subtotal}},
    }
    assert [i["sku"] for i in unit["items"]] == [line.line_id for line in cart.lines]
    assert all(isinstance(i["quantity"], str) and i["category"] == "PHYSICAL_GOODS" for i in unit["items"])


def test_capture_sends_request_id_and_rejects_bad_ids() -> None:
    fake = FakePayPal()
    paypal = fake.client()
    created = paypal.create_order(chair_cart(), custom_id="ord_1")
    result = paypal.capture_order(created["id"], request_id="capture-ord_1")
    assert fake.calls("capture")[0].headers["PayPal-Request-Id"] == "capture-ord_1"
    assert first_capture(result)["status"] == "COMPLETED"

    with pytest.raises(ValueError):
        paypal.capture_order("../../v1/oauth2/token", request_id="x")
    assert len(fake.calls("capture")) == 1


def test_error_body_is_parsed_into_codes() -> None:
    fake = FakePayPal()
    fake.fail_next["create"] = (422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_MISMATCH")
    with pytest.raises(PayPalError) as info:
        fake.client().create_order(chair_cart(), custom_id="ord_1")
    assert (info.value.status_code, info.value.name, info.value.issue, info.value.debug_id) == (
        422, "UNPROCESSABLE_ENTITY", "ITEM_TOTAL_MISMATCH", "dbg0001",
    )


def test_network_failure_raises_unavailable() -> None:
    fake = FakePayPal()
    fake.fail_next["token"] = "network"
    with pytest.raises(PayPalUnavailable):
        fake.client().access_token()


# --- Routes ---------------------------------------------------------------------------------


def test_checkout_config_returns_public_settings(client: TestClient) -> None:
    r = client.get("/checkout/config")
    assert r.status_code == 200
    assert r.json() == {"clientId": CLIENT_ID, "currency": "USD", "env": "sandbox"}
    assert CLIENT_SECRET not in r.text


def test_create_stores_order_keyed_by_paypal_id(client: TestClient, fake_paypal: FakePayPal) -> None:
    r = client.post("/checkout/orders", json=CHAIR_BODY)
    assert r.status_code == 201
    order = r.json()
    assert order["id"] in fake_paypal.orders
    approve = next(link for link in order["links"] if link["rel"] == "approve")
    assert approve["href"] == f"https://www.sandbox.paypal.com/checkoutnow?token={order['id']}"

    record = client.get(f"/checkout/orders/{order['id']}").json()
    assert record["status"] == "created"
    assert record["paypalCaptureId"] is None
    sent = json.loads(fake_paypal.calls("create")[0].content)
    assert sent["purchase_units"][0]["custom_id"] == record["id"]
    assert sent["purchase_units"][0]["amount"]["value"] == record["total"] == "250.67"


def test_capture_records_paypal_capture_id(client: TestClient, fake_paypal: FakePayPal) -> None:
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 200
    paid = r.json()
    assert paid["status"] == "paid"
    assert paid["paypalCaptureId"] == first_capture(fake_paypal.orders[paypal_id])["id"]
    assert client.get(f"/checkout/orders/{paypal_id}").json() == paid


def test_repeat_capture_is_idempotent(client: TestClient, fake_paypal: FakePayPal) -> None:
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    first = client.post(f"/checkout/orders/{paypal_id}/capture").json()
    second = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert second.status_code == 200
    assert second.json() == first
    assert len(fake_paypal.calls("capture")) == 1  # PayPal was not asked twice


def test_capture_already_captured_at_paypal_reads_it_back(client: TestClient, fake_paypal: FakePayPal) -> None:
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    fake_paypal.capture(paypal_id)  # e.g. an earlier capture whose response was lost
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 200
    assert r.json()["status"] == "paid"
    assert r.json()["paypalCaptureId"] == first_capture(fake_paypal.orders[paypal_id])["id"]
    assert len(fake_paypal.calls("get")) == 1


def test_capture_not_completed_is_not_paid(client: TestClient, fake_paypal: FakePayPal) -> None:
    fake_paypal.capture_status = "PENDING"
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 409
    assert "PENDING" in r.json()["detail"]
    record = client.get(f"/checkout/orders/{paypal_id}").json()
    assert record["status"] == "created"
    assert record["paypalCaptureId"] is not None


def test_capture_unapproved_order_409(client: TestClient, fake_paypal: FakePayPal) -> None:
    fake_paypal.approve_on_create = False
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 409
    assert r.json()["detail"].startswith("ORDER_NOT_APPROVED")


def test_capture_declined_402(client: TestClient, fake_paypal: FakePayPal) -> None:
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    fake_paypal.fail_next["capture"] = (422, "UNPROCESSABLE_ENTITY", "INSTRUMENT_DECLINED")
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 402
    assert r.json()["detail"].startswith("INSTRUMENT_DECLINED")
    assert client.get(f"/checkout/orders/{paypal_id}").json()["status"] == "created"


def test_create_upstream_error_502_and_nothing_stored(
    client: TestClient, fake_paypal: FakePayPal, caplog: pytest.LogCaptureFixture
) -> None:
    fake_paypal.fail_next["create"] = (500, "INTERNAL_SERVER_ERROR", None)
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        r = client.post("/checkout/orders", json=CHAIR_BODY)
    assert r.status_code == 502
    assert "dbg0001" in r.json()["detail"]
    assert client.app.state.orders == {}
    assert CLIENT_SECRET not in r.text and CLIENT_SECRET not in caplog.text
    assert "INTERNAL_SERVER_ERROR" in caplog.text


def test_create_bad_credentials_502(client: TestClient, fake_paypal: FakePayPal) -> None:
    fake_paypal.fail_next["token"] = (401, "invalid_client", None)
    r = client.post("/checkout/orders", json=CHAIR_BODY)
    assert r.status_code == 502
    assert CLIENT_SECRET not in r.text
    assert client.app.state.orders == {}


def test_capture_network_failure_502_not_paid(client: TestClient, fake_paypal: FakePayPal) -> None:
    paypal_id = client.post("/checkout/orders", json=CHAIR_BODY).json()["id"]
    fake_paypal.fail_next["capture"] = "network"
    r = client.post(f"/checkout/orders/{paypal_id}/capture")
    assert r.status_code == 502
    assert client.get(f"/checkout/orders/{paypal_id}").json()["status"] == "created"
    # Retrying after the outage reuses the same PayPal-Request-Id and succeeds.
    assert client.post(f"/checkout/orders/{paypal_id}/capture").json()["status"] == "paid"
    ids = {r.headers["PayPal-Request-Id"] for r in fake_paypal.calls("capture")}
    assert len(ids) == 1


def test_get_unknown_order_404(client: TestClient) -> None:
    assert client.get("/checkout/orders/NOSUCHORDER000000").status_code == 404


def test_checkout_routes_503_when_paypal_not_configured() -> None:
    app = create_app(cors_origins=[])
    app.state.paypal = None
    c = TestClient(app)
    assert c.get("/checkout/config").status_code == 503
    assert c.post("/checkout/orders", json=CHAIR_BODY).status_code == 503
    assert app.state.orders == {}
