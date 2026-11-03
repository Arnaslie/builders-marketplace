"""The Claude agent behind /agent/build-cart, tested against a scripted fake client (no network).

Chair, owned defaults (drill, tape, glasses): subtotal 250.67. With a 200.00 budget the
deterministic cart swaps only the miter saw to the 24.98 miter box (146.65). Alternatives by
index: miter saw 0 = miter box 24.98, 1 = circular saw 59.00; pocket jig 0 = mini jig 19.99
(saves 20.00); polyurethane 0 = half pint 8.98 (saves 7.00).
"""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import agent
from app.agent import build_agent_cart
from app.main import create_app
from app.store import FixtureStore, fixtures_dir

OWNED = ["chair-drill", "chair-tape-measure", "chair-safety-glasses"]
SAW_TO_CIRCULAR = {"line_id": "chair-miter-saw", "alternative_index": 1, "reason": "A circular saw still makes straight cuts."}


@pytest.fixture(scope="module")
def chair():
    return FixtureStore.from_dir(fixtures_dir()).by_id("proj-chair")


def tool_use(name: str, tool_input: dict, id_: str = "toolu_1"):
    return SimpleNamespace(
        stop_reason="tool_use",
        content=[SimpleNamespace(type="tool_use", id=id_, name=name, input=tool_input)],
    )


def submit(*swaps: dict):
    return tool_use("submit_swaps", {"swaps": list(swaps)})


class FakeClient:
    """Stands in for anthropic.Anthropic: replays scripted responses, records what was sent."""

    def __init__(self, *responses) -> None:
        self.responses = list(responses)
        self.requests: list[dict] = []
        self.messages = self

    def create(self, **kwargs):
        self.requests.append({**kwargs, "messages": list(kwargs["messages"])})
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def run(chair, client, budget="200.00", owned=OWNED, monkeypatch=None):
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(agent, "make_client", lambda: client)
    return build_agent_cart(chair, owned, budget)


def test_valid_swap_is_applied_and_priced_by_cart_rules(chair, monkeypatch) -> None:
    client = FakeClient(submit(SAW_TO_CIRCULAR))
    cart = run(chair, client, monkeypatch=monkeypatch)
    assert cart.agent_used is True
    assert [s.line_id for s in cart.swaps] == ["chair-miter-saw"]
    assert cart.swaps[0].to.price == "59.00"  # the agent's pick, not the cheapest
    assert cart.swaps[0].savings == "70.00"
    assert cart.swaps[0].reason == SAW_TO_CIRCULAR["reason"]
    assert cart.subtotal == "180.67"
    assert cart.within_budget is True
    saw = next(line for line in cart.lines if line.line_id == "chair-miter-saw")
    assert (saw.swapped, saw.unit_price, saw.reason) == (True, "59.00", SAW_TO_CIRCULAR["reason"])
    assert client.requests[0]["model"] == "claude-sonnet-5-5"


def test_model_id_is_overridable(chair, monkeypatch) -> None:
    monkeypatch.setenv("LLM_MODEL", "claude-opus-5-5")
    client = FakeClient(submit(SAW_TO_CIRCULAR))
    run(chair, client, monkeypatch=monkeypatch)
    assert client.requests[0]["model"] == "claude-opus-5-5"


def test_lookup_round_trip_returns_tool_results(chair, monkeypatch) -> None:
    client = FakeClient(tool_use("list_alternatives", {"line_id": "chair-miter-saw"}), submit(SAW_TO_CIRCULAR))
    cart = run(chair, client, monkeypatch=monkeypatch)
    assert cart.agent_used is True
    second = client.requests[1]["messages"]
    result = second[-1]["content"][0]
    assert result["type"] == "tool_result" and result["tool_use_id"] == "toolu_1"
    assert "Miter box with 14 in back saw" in result["content"]
    assert "is_error" not in result


def test_lookup_of_unknown_line_is_an_error_result_not_a_crash(chair, monkeypatch) -> None:
    client = FakeClient(tool_use("get_line_details", {"line_id": "chair-hammer"}), submit(SAW_TO_CIRCULAR))
    cart = run(chair, client, monkeypatch=monkeypatch)
    assert cart.agent_used is True
    assert client.requests[1]["messages"][-1]["content"][0]["is_error"] is True


def test_invented_line_is_dropped_but_valid_swap_kept(chair, monkeypatch) -> None:
    invented = {"line_id": "chair-hammer", "alternative_index": 0, "reason": "Cheaper hammer."}
    cart = run(chair, FakeClient(submit(invented, SAW_TO_CIRCULAR)), monkeypatch=monkeypatch)
    assert cart.agent_used is True
    assert [s.line_id for s in cart.swaps] == ["chair-miter-saw"]


@pytest.mark.parametrize(
    "bad",
    [
        {"line_id": "chair-hammer", "alternative_index": 0, "reason": "invented line"},
        {"line_id": "chair-miter-saw", "alternative_index": 5, "reason": "invented alternative"},
        {"line_id": "chair-miter-saw", "alternative_index": True, "reason": "bool is not an index"},
        {"line_id": "chair-drill", "alternative_index": 0, "reason": "owned line"},
        {"line_id": "chair-pine-2x2", "alternative_index": 0, "reason": "line has no alternatives"},
        {"line_id": "chair-miter-saw", "alternative_index": 0, "reason": ""},
    ],
)
def test_only_invalid_proposals_fall_back_to_deterministic(chair, monkeypatch, bad) -> None:
    cart = run(chair, FakeClient(submit(bad)), monkeypatch=monkeypatch)
    assert cart.agent_used is False
    assert cart.subtotal == "146.65"
    assert [s.line_id for s in cart.swaps] == ["chair-miter-saw"]


def test_cart_that_would_be_over_budget_is_rejected(chair, monkeypatch) -> None:
    only_poly = {"line_id": "chair-polyurethane", "alternative_index": 0, "reason": "Half pint is plenty."}
    cart = run(chair, FakeClient(submit(only_poly)), monkeypatch=monkeypatch)  # 243.67 > 200.00
    assert cart.agent_used is False
    assert cart.within_budget is True
    assert cart.subtotal == "146.65"


def test_second_swap_of_same_line_is_ignored(chair, monkeypatch) -> None:
    again = {**SAW_TO_CIRCULAR, "alternative_index": 0, "reason": "Second thoughts."}
    cart = run(chair, FakeClient(submit(SAW_TO_CIRCULAR, again)), monkeypatch=monkeypatch)
    assert [s.to.price for s in cart.swaps] == ["59.00"]


def test_no_api_key_uses_deterministic_cart(chair) -> None:
    cart = build_agent_cart(chair, OWNED, "200.00")  # conftest removes LLM_API_KEY
    assert cart.agent_used is False
    assert cart.subtotal == "146.65"


def test_client_error_falls_back(chair, monkeypatch) -> None:
    cart = run(chair, FakeClient(TimeoutError("slow")), monkeypatch=monkeypatch)
    assert cart.agent_used is False
    assert cart.subtotal == "146.65"


def test_model_that_never_submits_falls_back(chair, monkeypatch) -> None:
    end_turn = SimpleNamespace(stop_reason="end_turn", content=[])
    cart = run(chair, FakeClient(end_turn), monkeypatch=monkeypatch)
    assert cart.agent_used is False


def test_model_is_not_called_when_it_has_nothing_to_decide(chair, monkeypatch) -> None:
    for budget in (None, "300.00"):  # no budget; already within budget
        client = FakeClient()  # any call would pop from an empty list and raise
        cart = run(chair, client, budget=budget, monkeypatch=monkeypatch)
        assert client.requests == []
        assert cart.agent_used is False and cart.swaps == []


def test_route_returns_agent_cart(monkeypatch) -> None:
    monkeypatch.setenv("LLM_API_KEY", "test-key")
    monkeypatch.setattr(agent, "make_client", lambda: FakeClient(submit(SAW_TO_CIRCULAR)))
    client = TestClient(create_app(cors_origins=["http://localhost:3000"]))
    r = client.post("/agent/build-cart", json={"projectId": "proj-chair", "owned": OWNED, "budget": "200.00"})
    assert r.status_code == 200
    body = r.json()
    assert body["agentUsed"] is True
    assert body["subtotal"] == "180.67"
    assert body["swaps"][0]["reason"] == SAW_TO_CIRCULAR["reason"]


def test_route_unknown_owned_still_422(client: TestClient) -> None:
    r = client.post("/agent/build-cart", json={"projectId": "proj-chair", "owned": ["chair-hammer"], "budget": "100.00"})
    assert r.status_code == 422
