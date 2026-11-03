import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app

FRONTEND = "http://localhost:3000"  # same origin conftest.client allows

CONTRACT = Path(__file__).resolve().parents[2] / "contract" / "openapi.json"
CHAIR_ID = "proj-chair"
CHAIR_OWNED_DEFAULT = ["chair-drill", "chair-tape-measure", "chair-safety-glasses"]


def test_healthz(client: TestClient) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.text == '{"status":"ok"}'


def test_list_projects(client: TestClient) -> None:
    r = client.get("/projects")
    assert r.status_code == 200
    body = r.json()
    assert [p["slug"] for p in body] == ["simple-wooden-chair", "forged-kitchen-knife", "wooden-squat-rack"]
    chair = body[0]
    assert chair["lineCount"] == 12
    assert chair["estimatedTotal"] == "364.62"
    assert "materials" not in chair


def test_get_project_camel_case(client: TestClient) -> None:
    r = client.get("/projects/simple-wooden-chair")
    assert r.status_code == 200
    project = r.json()
    assert project["id"] == CHAIR_ID
    assert len(project["materials"]) == 12
    line = project["materials"][0]
    assert set(line) >= {
        "id", "name", "qty", "unit", "category", "channel3ProductId", "price",
        "currency", "retailer", "productUrl", "imageUrl", "ownedDefault",
    }
    assert line["channel3ProductId"] is None
    assert {m["category"] for m in project["materials"]} == {"tool", "material"}


def test_get_project_404(client: TestClient) -> None:
    assert client.get("/projects/no-such-project").status_code == 404


def test_create_recommendation_is_draft(client: TestClient) -> None:
    r = client.post(
        "/recommendations",
        json={
            "title": "Cedar Planter Box",
            "summary": "Raised planter from cedar fence pickets.",
            "materials": [{"name": "Cedar fence picket", "qty": 8, "unit": "board", "category": "material"}],
        },
    )
    assert r.status_code == 201
    rec = r.json()
    assert rec["status"] == "draft"
    assert rec["slug"] == "cedar-planter-box"
    assert rec["id"].startswith("rec_")
    assert rec["steps"] == []
    assert "createdAt" in rec


def test_create_recommendation_rejects_unknown_fields(client: TestClient) -> None:
    r = client.post(
        "/recommendations",
        json={
            "title": "Box",
            "summary": "",
            "materials": [{"name": "Plywood", "qty": 1, "unit": "sheet", "category": "material"}],
            "price": "1.00",
        },
    )
    assert r.status_code == 422


def test_build_cart_route(client: TestClient) -> None:
    r = client.post(
        "/agent/build-cart",
        json={"projectId": CHAIR_ID, "owned": CHAIR_OWNED_DEFAULT, "budget": "200.00"},
    )
    assert r.status_code == 200
    cart = r.json()
    assert cart["subtotal"] == "146.65"
    assert cart["withinBudget"] is True
    assert cart["skippedLineIds"] == CHAIR_OWNED_DEFAULT
    assert [s["lineId"] for s in cart["swaps"]] == ["chair-miter-saw"]
    swap = cart["swaps"][0]
    assert swap["from"]["price"] == "129.00"
    assert swap["to"]["price"] == "24.98"
    assert swap["savings"] == "104.02"


def test_build_cart_unknown_project_404(client: TestClient) -> None:
    r = client.post("/agent/build-cart", json={"projectId": "nope"})
    assert r.status_code == 404


def test_build_cart_unknown_owned_422(client: TestClient) -> None:
    r = client.post("/agent/build-cart", json={"projectId": CHAIR_ID, "owned": ["chair-hammer"]})
    assert r.status_code == 422
    assert "chair-hammer" in r.json()["detail"]


def test_build_cart_rejects_float_budget(client: TestClient) -> None:
    r = client.post("/agent/build-cart", json={"projectId": CHAIR_ID, "budget": 200})
    assert r.status_code == 422


def test_checkout_create_and_capture(client: TestClient) -> None:
    r = client.post("/checkout/orders", json={"projectId": CHAIR_ID, "owned": CHAIR_OWNED_DEFAULT})
    assert r.status_code == 201
    order = r.json()
    assert order["status"] == "CREATED"
    assert order["intent"] == "CAPTURE"
    assert len(order["id"]) == 17
    assert order["purchase_units"][0]["amount"] == {"currency_code": "USD", "value": "250.67"}
    assert {link["rel"] for link in order["links"]} == {"approve", "capture"}

    r = client.post(f"/checkout/orders/{order['id']}/capture")
    assert r.status_code == 200
    paid = r.json()
    assert paid["status"] == "paid"
    assert paid["fulfilment"] == "simulated"
    assert paid["paypalOrderId"] == order["id"]
    assert paid["paypalCaptureId"]
    assert paid["total"] == "250.67"

    # Capture is idempotent now (PayPal allows one capture per order): a repeat returns the record.
    again = client.post(f"/checkout/orders/{order['id']}/capture")
    assert again.status_code == 200
    assert again.json() == paid


def test_checkout_empty_cart_422(client: TestClient) -> None:
    owned_all = [m["id"] for m in client.get("/projects/forged-kitchen-knife").json()["materials"]]
    r = client.post("/checkout/orders", json={"projectId": "proj-knife", "owned": owned_all})
    assert r.status_code == 422


def test_capture_unknown_order_404(client: TestClient) -> None:
    assert client.post("/checkout/orders/NOSUCHORDER000000/capture").status_code == 404


def test_paypal_webhook_accepts(client: TestClient) -> None:
    r = client.post("/webhooks/paypal", json={"id": "WH-1", "event_type": "PAYMENT.CAPTURE.COMPLETED"})
    assert r.status_code == 200
    assert r.json() == {"received": True}


def test_cors_allows_frontend_origin(client: TestClient) -> None:
    r = client.options(
        "/agent/build-cart",
        headers={"Origin": FRONTEND, "Access-Control-Request-Method": "POST",
                 "Access-Control-Request-Headers": "content-type"},
    )
    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == FRONTEND


def test_cors_rejects_other_origin(client: TestClient) -> None:
    r = client.get("/healthz", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers


def test_cors_origins_from_env(monkeypatch) -> None:
    monkeypatch.setenv("CORS_ALLOW_ORIGINS", "https://diy-wikipedia.onrender.com/, http://localhost:3000")
    c = TestClient(create_app())
    r = c.get("/healthz", headers={"Origin": "https://diy-wikipedia.onrender.com"})
    assert r.headers["access-control-allow-origin"] == "https://diy-wikipedia.onrender.com"


def test_committed_contract_matches_app() -> None:
    committed = json.loads(CONTRACT.read_text(encoding="utf-8"))
    assert committed == create_app().openapi(), "run: uv run python scripts/export_openapi.py"
