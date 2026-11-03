"""scripts/price_cache.py with a fake Channel3 client: no network, no credits."""

import json
from decimal import Decimal

import pytest

from app.channel3 import Channel3AuthError, Channel3Error, Offer, Product
from app.prices import PriceCache
from scripts import price_cache
from scripts.price_cache import pick_best


def offer(price: str, domain: str = "www.homedepot.com", **kw) -> Offer:
    fields = {"url": f"https://{domain}/p", "domain": domain, "price": Decimal(price), "currency": "USD",
              "availability": "InStock", "condition": "new"} | kw
    return Offer(**fields)


def product(pid: str, *offers: Offer) -> Product:
    return Product(id=pid, title=f"Product {pid}", image_url=f"https://cdn.example.com/{pid}.png", offers=offers)


class FakeClient:
    def __init__(self, fail: dict[str, Exception] | None = None) -> None:
        self.queries: list[str] = []
        self.fail = fail or {}

    def search(self, query: str) -> list[Product]:
        self.queries.append(query)
        if query in self.fail:
            raise self.fail[query]
        if "anvil" in query:
            return [product("used", offer("50.00", condition="used"))]
        return [product(f"c3-{len(self.queries)}", offer("12.50", "lowes.com"), offer("9.99"))]


# --- pick_best ------------------------------------------------------------------------------


def test_pick_best_takes_cheapest_usable_offer_of_top_product() -> None:
    top = product("top", offer("20.00", "a.com"), offer("15.00", "b.com"), offer("1.00", "c.com", availability="OutOfStock"))
    second = product("second", offer("2.00"))
    best_product, best_offer = pick_best([top, second], "USD")
    assert (best_product.id, best_offer.price, best_offer.domain) == ("top", Decimal("15.00"), "b.com")


def test_pick_best_skips_products_without_usable_offers() -> None:
    unusable = product(
        "bad",
        offer("5.00", condition="used"),
        offer("5.00", currency="EUR"),
        offer("5.00", url="javascript:alert(1)"),
        offer("0.00"),
    )
    best_product, _ = pick_best([unusable, product("ok", offer("8.00", condition=None))], "USD")
    assert best_product.id == "ok"
    assert pick_best([unusable], "USD") is None
    assert pick_best([], "USD") is None


# --- the script -----------------------------------------------------------------------------


@pytest.fixture
def out(tmp_path):
    return tmp_path / "prices.json"


def run(out, client: FakeClient, *args: str) -> int:
    return price_cache.main([*args, "--out", str(out)], make_client=lambda: client)


def test_dry_run_calls_nothing_and_writes_nothing(out, capsys) -> None:
    def no_client():
        raise AssertionError("dry run must not build a client (no key needed)")

    assert price_cache.main(["--dry-run", "--out", str(out)], make_client=no_client) == 0
    assert not out.exists()
    printed = capsys.readouterr().out
    # 46 lines, 40 distinct phrases (drill x3, safety glasses x3, tape measure x2, sandpaper x2).
    assert printed.startswith("46 line(s) to price, 0 already cached, 40 Channel3 call(s) (40 credit(s))")
    assert "would search  proj-chair/chair-pine-2x2: '2x2 pine furring strip 8 ft'" in printed


def test_prices_every_flagship_line_once_per_unique_query(out) -> None:
    queries = json.loads((price_cache.DEFAULT_QUERIES).read_text())
    queries.pop("_about")
    client = FakeClient()
    assert run(out, client) == 0

    assert len(client.queries) == len(set(queries.values()))  # shared phrases cost one call
    cache = PriceCache.load(out)
    entry = cache.entry("proj-chair", "chair-pine-2x2")
    assert (entry.price, entry.retailer, entry.url, entry.query) == (
        "9.99", "homedepot.com", "https://www.homedepot.com/p", "2x2 pine furring strip 8 ft",
    )
    assert entry.image_url.startswith("https://cdn.example.com/")
    assert entry.fetched_at.tzinfo is not None
    # The same "20V cordless drill driver kit" phrase priced all three drill lines.
    drills = [cache.entry(p, f"{k}-drill") for p, k in (("proj-chair", "chair"), ("proj-knife", "knife"),
                                                         ("proj-squat-rack", "rack"))]
    assert len({d.channel3_product_id for d in drills}) == 1
    # Only used offers for the anvil: recorded as a miss, not a price.
    assert cache.entry("proj-knife", "knife-anvil") is None
    assert "none with an in-stock new USD offer" in cache.miss("proj-knife", "knife-anvil").reason
    priced = sum(len(v) for v in cache.projects.values()) + sum(len(v) for v in cache.misses.values())
    assert priced == len(queries)


def test_rerun_spends_nothing_and_refresh_spends_again(out) -> None:
    run(out, FakeClient())
    before = out.read_text()

    again = FakeClient()
    assert run(out, again) == 0
    assert again.queries == []  # priced lines and misses are both skipped
    assert out.read_text() == before

    refresh = FakeClient()
    assert run(out, refresh, "--refresh", "--line", "chair-drill", "--line", "knife-anvil") == 0
    assert refresh.queries == ["20V cordless drill driver kit", "steel bench block anvil 4x4"]


def test_project_filter(out) -> None:
    client = FakeClient()
    run(out, client, "--project", "proj-chair")
    assert set(PriceCache.load(out).projects) == {"proj-chair"}
    assert len(client.queries) == 12


def test_max_calls_refuses_before_spending(out) -> None:
    client = FakeClient()
    assert run(out, client, "--max-calls", "3") == 2
    assert client.queries == [] and not out.exists()


def test_auth_error_stops_and_keeps_what_was_paid_for(out) -> None:
    client = FakeClient(fail={"Titebond II wood glue 8 oz": Channel3AuthError("Channel3 402: no credits", 402)})
    assert run(out, client, "--project", "proj-chair") == 3
    cache = PriceCache.load(out)
    assert cache.entry("proj-chair", "chair-pine-2x2") is not None  # priced before the 402
    assert cache.entry("proj-chair", "chair-wood-glue") is None
    assert client.queries[-1] == "Titebond II wood glue 8 oz"  # nothing called after the 402


def test_transient_error_is_not_cached_so_next_run_retries(out) -> None:
    flaky = "Titebond II wood glue 8 oz"
    assert run(out, FakeClient(fail={flaky: Channel3Error("Channel3 503: busy", 503)}), "--project", "proj-chair") == 1
    cache = PriceCache.load(out)
    assert cache.entry("proj-chair", "chair-wood-glue") is None
    assert cache.miss("proj-chair", "chair-wood-glue") is None

    retry = FakeClient()
    assert run(out, retry, "--project", "proj-chair") == 0
    assert retry.queries == [flaky]


def test_missing_key_is_a_clean_error(out, monkeypatch, capsys) -> None:
    monkeypatch.delenv("CHANNEL3_API_KEY", raising=False)
    assert price_cache.main(["--out", str(out), "--line", "chair-drill"]) == 3
    assert "CHANNEL3_API_KEY is not set" in capsys.readouterr().err
    assert not out.exists()
