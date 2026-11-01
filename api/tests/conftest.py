import pytest
from fastapi.testclient import TestClient

from app.main import create_app

FRONTEND = "http://localhost:3000"


@pytest.fixture
def client() -> TestClient:
    # A fresh app per test: the in-memory order book never leaks between tests.
    return TestClient(create_app(cors_origins=[FRONTEND]))
