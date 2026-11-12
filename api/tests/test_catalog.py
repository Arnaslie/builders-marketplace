"""The full catalog: every fixture is a real project, listed, served by slug and checkoutable.

The 47 projects that used to be SAMPLE listings (contract/samples.json, ids "mock-...") are
ordinary fixtures now. Nothing in the API treats them differently from the flagships.
"""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURES = sorted((Path(__file__).resolve().parents[2] / "contract" / "fixtures").glob("*.json"))
PROJECTS = [json.loads(path.read_text()) for path in FIXTURES]


def test_every_fixture_is_listed(client: TestClient) -> None:
    listed = {p["id"] for p in client.get("/projects").json()}
    assert listed == {p["id"] for p in PROJECTS}
    assert len(listed) == 50


def test_no_project_id_uses_the_old_mock_prefix() -> None:
    assert not [p["id"] for p in PROJECTS if p["id"].startswith("mock-")]


@pytest.mark.parametrize("project", PROJECTS, ids=lambda p: p["slug"])
def test_every_project_is_served_by_slug(client: TestClient, project: dict) -> None:
    res = client.get(f"/projects/{project['slug']}")
    assert res.status_code == 200
    assert res.json()["id"] == project["id"]


@pytest.mark.parametrize("project", PROJECTS, ids=lambda p: p["slug"])
def test_every_project_checks_out(client: TestClient, fake_paypal, project: dict) -> None:
    body = {"projectId": project["id"], "owned": []}
    priced = client.post("/cart", json=body)
    assert priced.status_code == 200
    assert priced.json()["subtotal"] != "0.00"

    res = client.post("/checkout/orders", json=body)
    assert res.status_code == 201
    assert fake_paypal.requests  # the order reached (fake) PayPal
