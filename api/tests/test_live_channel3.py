"""Live Channel3 pricing on POST /recommendations: a cache miss reaches a real request-path call.

No network anywhere: the pricer's ``build`` is replaced with a fake that returns a fake Channel3
client, and conftest removes CHANNEL3_API_KEY so the default degrade path (no key) is always
available. The committed cache is tests/data/prices.sample.json: chair-pine-2x2 is cached,
everything else misses.
"""

from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import agent, channel3, drafts
from app.channel3 import Channel3AuthError, Channel3Client, Channel3Error, Offer, Product
from app.main import create_app
from tests.test_agent import FakeClient, tool_use

SAMPLE_PRICES = Path(__file__).parent / "data" / "prices.sample.json"
IDEA = {"title": "Pine Stool", "description": "A small three-legged stool from pine offcuts."}
UNKNOWN = {"name": "Left-handed widget", "qty": 2, "unit": "each", "category": "tool"}
KEY = "sk-live-test"


def submit_materials(*lines: dict):
    return tool_use("submit_materials", {"materials": list(lines)})


def offer(price: str, domain: str = "homedepot.com", **kw) -> Offer:
    fields = {"url": f"https://{domain}/p", "domain": domain, "price": Decimal(price),
              "currency": "USD", "availability": "InStock", "condition": "new"} | kw
    return Offer(**fields)


def product(pid: str, *offers: Offer, title: str | None = None) -> Product:
    return Product(id=pid, title=title or f"Product {pid}", image_url=f"https://cdn.example.com/{pid}.png",
                   offers=offers)


class FakeChannelClient:
    """A stand-in for Channel3Client: records queries, returns / raises for known names."""

    def __init__(self, products: dict[str, list[Product]], failures: dict[str, Exception] | None = None):
        self.products = products
        self.failures = failures or {}
        self.queries: list[str] = []

    def search(self, query: str, *, limit: int = 5, country: str = "US", currency: str = "USD"):
        self.queries.append(query)
        if query in self.failures:
            raise self.failures[query]
        return self.products.get(query, [])


@pytest.fixture
def live(request, monkeypatch):
    """Inject a fake Channel3 client into a fresh pricer and put it on the app."""
    products = getattr(request, "param", {})
    failures = getattr(request, "param_failures", {})
    fake = FakeChannelClient(products, failures)
    pricer = drafts.LiveChannel3Pricer(build=lambda: fake)
    return fake, pricer


@pytest.fixture
def api(monkeypatch, live) -> TestClient:
    fake, pricer = live
    monkeypatch.setenv("CONTRACT_PRICES_PATH", str(SAMPLE_PRICES))
    app = create_app(cors_origins=["http://localhost:3000"])
    app.state.live_pricer = pricer
    fake_agent = FakeClient(submit_materials(UNKNOWN))
    monkeypatch.setattr(agent, "make_client", lambda: fake_agent)
    return TestClient(app)


# --- prize-eligibility: a request path really reaches Channel3Client.search -----------------


def test_cache_miss_is_priced_from_a_live_search(api, live) -> None:
    fake, _ = live
    fake.products = {"Left-handed widget": [product("c3live1", offer("12.34", "widgets.com", condition=None))]}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    rec = r.json()
    (line,) = rec["materials"]
    assert line["priced"] is True
    assert (line["unitPrice"], line["lineTotal"], line["currency"]) == ("12.34", "24.68", "USD")
    assert line["retailer"] == "widgets.com" and line["channel3ProductId"] == "c3live1"
    assert rec["estimatedTotal"] == "24.68"
    assert (rec["pricedCount"], rec["unpricedCount"]) == (1, 0)
    assert fake.queries == ["Left-handed widget"]  # the request-path call really ran


def test_live_pricing_search_is_capped_per_request(api, live) -> None:
    fake, _ = live
    fake.products = {
        "Left-handed widget 1": [product("a", offer("1.00"))],
        "Left-handed widget 2": [product("b", offer("2.00"))],
        "Left-handed widget 3": [product("c", offer("3.00"))],
        "Left-handed widget 4": [product("d", offer("4.00"))],
        "Left-handed widget 5": [product("e", offer("5.00"))],
        "Left-handed widget 6": [product("f", offer("6.00"))],
    }
    fake_agent = FakeClient(submit_materials(
        {**UNKNOWN, "name": "Left-handed widget 1"}, {**UNKNOWN, "name": "Left-handed widget 2"},
        {**UNKNOWN, "name": "Left-handed widget 3"}, {**UNKNOWN, "name": "Left-handed widget 4"},
        {**UNKNOWN, "name": "Left-handed widget 5"}, {**UNKNOWN, "name": "Left-handed widget 6"},
    ))
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(agent, "make_client", lambda: fake_agent)
    try:
        r = api.post("/recommendations", json=IDEA)
    finally:
        monkeypatch.undo()
    assert r.status_code == 201
    rec = r.json()
    # Only MAX_LIVE_CALLS lines were searched; the cap made the rest stay unpriced.
    assert len(fake.queries) == drafts.MAX_LIVE_CALLS
    priced = [m for m in rec["materials"] if m["priced"]]
    unpriced = [m for m in rec["materials"] if not m["priced"]]
    assert len(priced) == drafts.MAX_LIVE_CALLS and len(unpriced) == 1


def test_live_pricing_cap_holds_when_channel3_keeps_failing(api, live) -> None:
    """A failing Channel3 must not cost one search per drafted line: the cap counts attempts.

    Regression: the cap used to be counted against memoized results, so when every search raised
    (5xx, timeout) nothing was memoized and each of the 30 draft lines spent its own search.
    """
    fake, _ = live
    names = [f"Left-handed widget {i}" for i in range(1, drafts.MAX_LIVE_CALLS + 3)]
    fake.failures = {name: Channel3Error("Channel3 503: busy", 503) for name in names}
    fake_agent = FakeClient(submit_materials(*[{**UNKNOWN, "name": name} for name in names]))
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(agent, "make_client", lambda: fake_agent)
    try:
        r = api.post("/recommendations", json=IDEA)
    finally:
        monkeypatch.undo()
    assert r.status_code == 201
    # Every line failed, but only the capped number of searches was ever attempted.
    assert len(fake.queries) == drafts.MAX_LIVE_CALLS
    assert all(m["priced"] is False for m in r.json()["materials"])
    assert r.json()["estimatedTotal"] == "0.00"


def test_a_repeated_failing_line_is_attempted_once(api, live) -> None:
    """A failure is memoized like a result, so a repeated line cannot re-spend on every draft."""
    fake, _ = live
    fake.failures = {"Left-handed widget": Channel3Error("Channel3 503: busy", 503)}
    for _ in range(3):
        fake_agent = FakeClient(submit_materials(UNKNOWN))
        monkeypatch = pytest.MonkeyPatch()
        monkeypatch.setattr(agent, "make_client", lambda: fake_agent)
        try:
            r = api.post("/recommendations", json=IDEA)
        finally:
            monkeypatch.undo()
        assert r.status_code == 201
    assert fake.queries == ["Left-handed widget"]  # attempted once, not once per draft


def test_repeated_draft_does_not_respend_the_same_line(api, live) -> None:
    fake, _ = live
    fake.products = {"Left-handed widget": [product("c3live1", offer("12.34", "widgets.com", condition=None))]}
    api.post("/recommendations", json=IDEA)
    assert fake.queries == ["Left-handed widget"]

    # A fresh request over the same in-process pricer must not pay for the same line again.
    fake_agent = FakeClient(submit_materials(UNKNOWN))
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(agent, "make_client", lambda: fake_agent)
    try:
        r = api.post("/recommendations", json=IDEA)
    finally:
        monkeypatch.undo()
    assert r.status_code == 201
    assert fake.queries == ["Left-handed widget"]  # memoized: no second search


# --- degrade: never turn a Channel3 failure or missing key into a 500 ------------------------


def test_missing_key_stays_201_and_unpriced(api) -> None:
    # conftest removed CHANNEL3_API_KEY, so from_env raises; the pricer must degrade silently.
    pricer = drafts.LiveChannel3Pricer()  # real from_env
    entry = pricer.price_line(drafts.DraftLine(name=UNKNOWN["name"], qty=UNKNOWN["qty"],
                                               unit=UNKNOWN["unit"], category=UNKNOWN["category"]))
    assert entry is None


def test_auth_error_stays_201_and_unpriced(api, live) -> None:
    fake, _ = live
    fake.failures = {"Left-handed widget": Channel3AuthError("Channel3 402: no credits", 402)}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    (line,) = r.json()["materials"]
    assert line["priced"] is False and line["unitPrice"] is None
    assert r.json()["estimatedTotal"] == "0.00"


def test_server_error_is_degraded_to_unpriced(api, live) -> None:
    fake, _ = live
    fake.failures = {"Left-handed widget": Channel3Error("Channel3 503: busy", 503)}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    (line,) = r.json()["materials"]
    assert line["priced"] is False


def test_non_usd_offer_is_never_priced(api, live) -> None:
    fake, _ = live
    fake.products = {"Left-handed widget": [product("eur", offer("10.00", currency="EUR"))]}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    (line,) = r.json()["materials"]
    assert line["priced"] is False  # a non-USD live offer must not price the draft


def test_no_usable_offer_is_an_unpriced_miss(api, live) -> None:
    fake, _ = live
    fake.products = {"Left-handed widget": [product("odd", offer("0.00"), offer("5.00", condition="used"))]}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    (line,) = r.json()["materials"]
    assert line["priced"] is False


def test_breakage_inside_search_never_500s(api, live) -> None:
    fake, _ = live
    fake.failures = {"Left-handed widget": RuntimeError("boom sk-very-secret")}
    r = api.post("/recommendations", json=IDEA)
    assert r.status_code == 201
    assert "sk-very-secret" not in r.text  # never leak a key-shaped string in a response


# --- the shared pick_best rule (moved into channel3.py) is exercised by both paths -----------


def test_pick_best_and_retailer_name_are_shared() -> None:
    assert channel3.pick_best is drafts.pick_best
    assert channel3.retailer_name is drafts.retailer_name
    products = [product("top", offer("20.00", "a.com"), offer("1.00", "b.com", availability="OutOfStock"))]
    best_product, best_offer = channel3.pick_best(products, "USD")
    assert (best_product.id, best_offer.price, best_offer.domain) == ("top", Decimal("20.00"), "a.com")
    assert channel3.retailer_name("www.homedepot.com") == "homedepot.com"