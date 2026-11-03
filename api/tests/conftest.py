import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.fake_paypal import FakePayPal

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
