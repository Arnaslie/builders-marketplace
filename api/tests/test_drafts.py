"""POST /recommendations: LLM-drafted materials priced only from the cache (no network, fake LLM).

The price cache is tests/data/prices.sample.json: chair-pine-2x2 is 3.47 USD, chair-wood-glue is a
EUR entry the draft must never use, and nothing else is cached.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import agent
from app.main import create_app
from tests.test_agent import FakeClient, tool_use

SAMPLE_PRICES = Path(__file__).parent / "data" / "prices.sample.json"
PINE = {"name": "2 in x 2 in x 8 ft pine furring strip", "qty": 4, "unit": "board", "category": "material"}
GLUE = {"name": "Titebond II Premium wood glue, 8 oz", "qty": 1, "unit": "each", "category": "material"}
UNKNOWN = {"name": "Left-handed widget", "qty": 2, "unit": "each", "category": "tool"}
IDEA = {"title": "Pine Stool", "description": "A small three-legged stool from pine offcuts."}


def submit_materials(*lines: dict):
    return tool_use("submit_materials", {"materials": list(lines)})


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("CONTRACT_PRICES_PATH", str(SAMPLE_PRICES))
    return TestClient(create_app(cors_origins=["http://localhost:3000"]))


def use_llm(monkeypatch: pytest.MonkeyPatch, *responses) -> FakeClient:
    fake = FakeClient(*responses)
    monkeypatch.setattr(agent, "make_client", lambda: fake)
    return fake


def test_happy_path_prices_matched_line_from_cache(api: TestClient, monkeypatch) -> None:
    fake = use_llm(monkeypatch, submit_materials(PINE))
    r = api.post("/recommendations", json={**IDEA, "skillLevel": "beginner", "imageUrl": "https://example.com/s.jpg"})
    assert r.status_code == 201
    rec = r.json()
    assert rec["status"] == "draft" and rec["id"].startswith("rec_") and rec["slug"] == "pine-stool"
    assert rec["skillLevel"] == "beginner" and rec["imageUrl"] == "https://example.com/s.jpg"
    (line,) = rec["materials"]
    assert line["priced"] is True
    assert (line["unitPrice"], line["lineTotal"], line["currency"]) == ("3.47", "13.88", "USD")
    assert line["retailer"] == "homedepot.com" and line["channel3ProductId"] == "c3pine22"
    assert rec["estimatedTotal"] == "13.88"
    assert (rec["pricedCount"], rec["unpricedCount"]) == (1, 0)
    # The model was asked for a forced tool call and shown the idea, but never a price.
    request = fake.requests[0]
    assert request["tool_choice"] == {"type": "tool", "name": "submit_materials"}
    assert "Pine Stool" in request["messages"][0]["content"]
    assert "beginner" in request["messages"][0]["content"]


def test_unmatched_line_is_unpriced_and_not_in_total(api: TestClient, monkeypatch) -> None:
    use_llm(monkeypatch, submit_materials(PINE, UNKNOWN))
    rec = api.post("/recommendations", json=IDEA).json()
    pine, widget = rec["materials"]
    assert pine["priced"] is True
    assert widget["priced"] is False
    for field in ("unitPrice", "lineTotal", "currency", "retailer", "productUrl", "imageUrl", "channel3ProductId"):
        assert widget[field] is None
    assert rec["estimatedTotal"] == "13.88"
    assert (rec["pricedCount"], rec["unpricedCount"]) == (1, 1)


def test_model_supplied_price_is_ignored(api: TestClient, monkeypatch) -> None:
    sneaky = {**UNKNOWN, "price": "0.01", "unit_price": "0.01"}
    use_llm(monkeypatch, submit_materials(sneaky))
    rec = api.post("/recommendations", json=IDEA).json()
    assert rec["materials"][0]["priced"] is False
    assert rec["estimatedTotal"] == "0.00"


def test_wrong_currency_cache_entry_is_not_used(api: TestClient, monkeypatch) -> None:
    use_llm(monkeypatch, submit_materials(GLUE))  # cache holds only a EUR entry for this
    rec = api.post("/recommendations", json=IDEA).json()
    assert rec["materials"][0]["priced"] is False
    assert rec["estimatedTotal"] == "0.00"


@pytest.mark.parametrize(
    "name",
    ["2x4 pine furring strip, 8 ft", "2x2 pine furring strip 10 ft", "2 in x 4 in x 8 ft pine furring strip"],
)
def test_different_size_is_not_priced_from_the_cached_size(api: TestClient, monkeypatch, name: str) -> None:
    use_llm(monkeypatch, submit_materials({**PINE, "name": name}))
    rec = api.post("/recommendations", json=IDEA).json()
    assert rec["materials"][0]["priced"] is False
    assert rec["materials"][0]["unitPrice"] is None
    assert rec["estimatedTotal"] == "0.00"


def test_same_size_written_differently_still_matches(api: TestClient, monkeypatch) -> None:
    use_llm(monkeypatch, submit_materials({**PINE, "name": "2x2 pine furring strip, 8 ft"}))
    rec = api.post("/recommendations", json=IDEA).json()
    assert rec["materials"][0]["priced"] is True
    assert rec["materials"][0]["unitPrice"] == "3.47"


def test_no_cache_means_everything_unpriced(monkeypatch) -> None:
    use_llm(monkeypatch, submit_materials(PINE))
    api = TestClient(create_app(cors_origins=["http://localhost:3000"]))  # conftest sets CONTRACT_PRICES_PATH=""
    rec = api.post("/recommendations", json=IDEA).json()
    assert rec["materials"][0]["priced"] is False
    assert rec["estimatedTotal"] == "0.00"


def test_malformed_model_lines_are_dropped(api: TestClient, monkeypatch) -> None:
    bad = [{"name": "", "qty": 1, "unit": "each", "category": "tool"}, {"name": "x", "qty": 0, "unit": "each", "category": "tool"}, "junk"]
    use_llm(monkeypatch, submit_materials(*bad, PINE, PINE))  # duplicate name kept once
    rec = api.post("/recommendations", json=IDEA).json()
    assert [m["name"] for m in rec["materials"]] == [PINE["name"]]


def test_llm_failure_is_a_json_502(api: TestClient, monkeypatch) -> None:
    use_llm(monkeypatch, RuntimeError("boom sk-secret"))
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 502
    assert r.headers["content-type"] == "application/json"
    assert "boom" not in r.text and "sk-secret" not in r.text
    assert "detail" in r.json()


def test_model_returning_nothing_usable_is_a_502(api: TestClient, monkeypatch) -> None:
    use_llm(monkeypatch, submit_materials())
    assert api.post("/recommendations", json=IDEA).status_code == 502


def test_missing_llm_key_is_a_json_503(api: TestClient) -> None:
    r = api.post("/recommendations", json=IDEA)  # conftest removes LLM_API_KEY
    assert r.status_code == 503
    assert "LLM_API_KEY" in r.json()["detail"]


@pytest.mark.parametrize(
    "extra",
    [{"title": "ab"}, {"description": "short"}, {"skillLevel": "wizard"}, {"imageUrl": "javascript:alert(1)"}, {"materials": []}],
)
def test_invalid_request_is_422_and_never_calls_the_llm(api: TestClient, monkeypatch, extra) -> None:
    fake = use_llm(monkeypatch)
    assert api.post("/recommendations", json={**IDEA, **extra}).status_code == 422
    assert fake.requests == []


def test_draft_is_excluded_from_projects_but_readable_by_id(api: TestClient, monkeypatch) -> None:
    before = api.get("/projects").json()
    use_llm(monkeypatch, submit_materials(PINE))
    rec = api.post("/recommendations", json=IDEA).json()
    after = api.get("/projects").json()
    assert after == before
    assert rec["slug"] not in [p["slug"] for p in after] and rec["id"] not in [p["id"] for p in after]
    assert api.get(f"/projects/{rec['slug']}").status_code == 404
    assert api.get(f"/recommendations/{rec['id']}").json() == rec
    assert api.get("/recommendations/rec_nope").status_code == 404


def _provider_400(message: str):
    """A real SDK BadRequestError, shaped the way anthropic raises it for an HTTP 400."""
    import anthropic
    import httpx

    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    body = {"type": "error", "error": {"type": "invalid_request_error", "message": message}}
    return anthropic.BadRequestError(message, response=httpx.Response(400, request=request), body=body)


def test_provider_rejection_is_logged_with_its_reason_and_not_called_a_timeout(api: TestClient, monkeypatch, caplog) -> None:
    use_llm(monkeypatch, _provider_400("tool_choice is not supported with sk-ant-abc123secret"))
    with caplog.at_level("WARNING", logger="uvicorn.error"):
        r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 502
    assert "rejected" in r.json()["detail"] and "HTTP 400" in r.json()["detail"]
    assert "tool_choice" not in r.text  # the provider's wording stays in the server log
    logged = caplog.text
    assert "BadRequestError 400: tool_choice is not supported" in logged
    assert "abc123secret" not in logged and "sk-***" in logged


def test_describe_llm_error_falls_back_to_the_exception_text() -> None:
    assert agent.describe_llm_error(TimeoutError("agent exceeded LLM_TIMEOUT_SECONDS")) == (
        "TimeoutError: agent exceeded LLM_TIMEOUT_SECONDS"
    )
    assert agent.llm_status(RuntimeError("x")) is None
