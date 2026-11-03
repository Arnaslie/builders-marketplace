import pytest
from fastapi.testclient import TestClient

from app.main import create_app

FRONTEND = "http://localhost:3000"


@pytest.fixture
def client() -> TestClient:
    # A fresh app per test: the in-memory order book never leaks between tests.
    return TestClient(create_app(cors_origins=[FRONTEND]))


@pytest.fixture(autouse=True)
def no_llm_key(monkeypatch: pytest.MonkeyPatch) -> None:
    # No test may reach the real Anthropic API, even when LLM_API_KEY is set in the shell.
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    monkeypatch.delenv("LLM_MODEL", raising=False)
