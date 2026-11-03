import os

import pytest
from fastapi.testclient import TestClient

# Tests assert hand-checked totals from contract/fixtures (e.g. chair 364.62). Turn the Channel3
# price overlay off so a committed contract/prices.json cannot change them; the overlay has its
# own tests (test_prices.py) that point CONTRACT_PRICES_PATH at tests/data/prices.sample.json.
os.environ["CONTRACT_PRICES_PATH"] = ""

from app.main import create_app  # noqa: E402

FRONTEND = "http://localhost:3000"


@pytest.fixture
def client() -> TestClient:
    # A fresh app per test: the in-memory order book never leaks between tests.
    return TestClient(create_app(cors_origins=[FRONTEND]))
