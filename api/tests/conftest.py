import os

import pytest
from fastapi.testclient import TestClient

# Tests assert hand-checked totals from contract/fixtures (e.g. chair 364.62). Turn the Channel3
# price overlay off so a committed contract/prices.json cannot change them; the overlay has its
# own tests (test_prices.py) that point CONTRACT_PRICES_PATH at tests/data/prices.sample.json.
os.environ["CONTRACT_PRICES_PATH"] = ""

from app.main import create_app  # noqa: E402
from tests.fake_paypal import FakePayPal  # noqa: E402

FRONTEND = "http://localhost:3000"


@pytest.fixture
def fake_paypal() -> FakePayPal:
    return FakePayPal()


@pytest.fixture
def client(fake_paypal: FakePayPal) -> TestClient:
    # A fresh app per test: the in-memory order book never leaks between tests.
    # PayPal is the in-memory fake (tests/fake_paypal.py): no network, whatever the environment holds.
    app = create_app(cors_origins=[FRONTEND])
    app.state.paypal = fake_paypal.client()
    return TestClient(app)
