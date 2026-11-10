"""SAMPLE projects (contract/samples.json): the agent and /cart price them, nothing else touches them.

Expected totals are summed here from the JSON with Decimal, not taken from the code under test.
"""

import json
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.store import FixtureStore, fixtures_dir

SAMPLES = json.loads((Path(__file__).resolve().parents[2] / "contract" / "samples.json").read_text())
SAMPLE = SAMPLES[0]


def _subtotal(project: dict, owned: set[str]) -> Decimal:
    return sum((Decimal(m["price"]) * m["qty"] for m in project["materials"] if m["id"] not in owned), Decimal("0"))


def test_samples_load_and_are_not_listed(client: TestClient) -> None:
    store = FixtureStore.from_dir(fixtures_dir())
    assert len(SAMPLES) == 47
    assert all(store.is_sample(p["id"]) for p in SAMPLES)
    assert not store.is_sample("proj-chair")
    ids = [p["id"] for p in client.get("/projects").json()]
    assert ids == ["proj-chair", "proj-knife", "proj-squat-rack"]
    assert client.get(f"/projects/{SAMPLE['slug']}").status_code == 404


def test_agent_prices_a_sample_project(client: TestClient) -> None:
    owned = [m["id"] for m in SAMPLE["materials"] if m["ownedDefault"]]
    res = client.post("/agent/build-cart", json={"projectId": SAMPLE["id"], "owned": owned})
    assert res.status_code == 200
    cart = res.json()
    assert cart["subtotal"] == str(_subtotal(SAMPLE, set(owned)).quantize(Decimal("0.01")))
    assert {line["lineId"] for line in cart["lines"]} == {m["id"] for m in SAMPLE["materials"]} - set(owned)
    assert cart["swaps"] == []  # samples list no alternatives


def test_agent_skips_every_owned_line_and_checks_budget(client: TestClient) -> None:
    all_ids = [m["id"] for m in SAMPLE["materials"]]
    cart = client.post("/agent/build-cart", json={"projectId": SAMPLE["id"], "owned": all_ids}).json()
    assert cart["lines"] == [] and cart["subtotal"] == "0.00"
    over = client.post("/agent/build-cart", json={"projectId": SAMPLE["id"], "owned": [], "budget": "1.00"}).json()
    assert over["withinBudget"] is False


def test_agent_rejects_an_unknown_line_on_a_sample(client: TestClient) -> None:
    res = client.post("/agent/build-cart", json={"projectId": SAMPLE["id"], "owned": ["nope"]})
    assert res.status_code == 422


def test_cart_prices_a_sample_but_checkout_refuses(client: TestClient, fake_paypal) -> None:
    body = {"projectId": SAMPLE["id"], "owned": []}
    priced = client.post("/cart", json=body)
    assert priced.status_code == 200
    assert priced.json()["subtotal"] == str(_subtotal(SAMPLE, set()).quantize(Decimal("0.01")))

    refused = client.post("/checkout/orders", json=body)
    assert refused.status_code == 422
    assert "no checkout" in refused.json()["detail"]
    assert fake_paypal.requests == []  # nothing reached PayPal


def test_a_real_project_still_checks_out(client: TestClient) -> None:
    res = client.post("/checkout/orders", json={"projectId": "proj-chair", "owned": []})
    assert res.status_code == 201


@pytest.mark.parametrize("bad", ["chair", "proj-x"])
def test_sample_ids_must_use_the_mock_prefix(tmp_path: Path, bad: str) -> None:
    from app.store import load_samples

    path = tmp_path / "samples.json"
    path.write_text(json.dumps([{**SAMPLE, "id": bad}]))
    with pytest.raises(ValueError, match="mock-"):
        load_samples(path)
