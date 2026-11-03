"""Price cache overlay (app/prices.py + app/store.py) using tests/data/prices.sample.json."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.prices import PriceCache, prices_path
from app.store import FixtureStore, fixtures_dir

SAMPLE = Path(__file__).parent / "data" / "prices.sample.json"


@pytest.fixture
def with_sample(monkeypatch) -> None:
    monkeypatch.setenv("CONTRACT_PRICES_PATH", str(SAMPLE))


def _line(store: FixtureStore, line_id: str):
    return next(line for line in store.by_id("proj-chair").materials if line.id == line_id)


def test_overlay_replaces_price_retailer_link_and_image(with_sample) -> None:
    line = _line(FixtureStore.from_dir(fixtures_dir()), "chair-pine-2x2")
    assert (line.price, line.retailer, line.product_url, line.image_url, line.channel3_product_id) == (
        "3.47", "homedepot.com", "https://www.homedepot.com/p/furring-strip-2x2",
        "https://cdn.example.com/pine-2x2.png", "c3pine22",
    )
    assert line.name == "2 in x 2 in x 8 ft pine furring strip"  # fixture name and qty are kept
    assert line.qty == 3


def test_uncached_and_wrong_currency_lines_keep_fixture_values(with_sample) -> None:
    store = FixtureStore.from_dir(fixtures_dir())
    glue = _line(store, "chair-wood-glue")  # EUR entry in a USD project
    assert (glue.price, glue.retailer, glue.channel3_product_id) == ("4.97", "Lowe's", None)
    screws = _line(store, "chair-pocket-screws")
    assert (screws.price, screws.channel3_product_id) == ("6.98", None)


def test_stale_entries_are_ignored(with_sample) -> None:
    store = FixtureStore.from_dir(fixtures_dir())  # sample has chair-hammer, which no fixture has
    assert "chair-hammer" not in {line.id for line in store.by_id("proj-chair").materials}
    assert len(store.by_id("proj-chair").materials) == 12


def test_overlay_off_by_env(monkeypatch) -> None:
    monkeypatch.setenv("CONTRACT_PRICES_PATH", "")
    assert prices_path() is None
    assert _line(FixtureStore.from_dir(fixtures_dir()), "chair-pine-2x2").price == "3.28"


def test_missing_file_is_no_overlay(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("CONTRACT_PRICES_PATH", str(tmp_path / "nope.json"))
    assert _line(FixtureStore.from_dir(fixtures_dir()), "chair-pine-2x2").price == "3.28"


def test_malformed_cache_fails_startup(monkeypatch, tmp_path) -> None:
    bad = tmp_path / "prices.json"
    bad.write_text('{"projects": {"proj-chair": {"chair-pine-2x2": {"price": "3.4"}}}}')
    monkeypatch.setenv("CONTRACT_PRICES_PATH", str(bad))
    with pytest.raises(ValueError):
        FixtureStore.from_dir(fixtures_dir())


def test_api_serves_overlaid_prices(with_sample) -> None:
    client = TestClient(create_app(cors_origins=[]))
    project = client.get("/projects/simple-wooden-chair").json()
    pine = next(m for m in project["materials"] if m["id"] == "chair-pine-2x2")
    assert pine["price"] == "3.47"
    assert pine["channel3ProductId"] == "c3pine22"
    summary = next(p for p in client.get("/projects").json() if p["id"] == "proj-chair")
    assert summary["estimatedTotal"] == "365.19"  # 364.62 + 3 x (3.47 - 3.28)
    cart = client.post("/agent/build-cart", json={"projectId": "proj-chair"}).json()
    assert next(line for line in cart["lines"] if line["lineId"] == "chair-pine-2x2")["unitPrice"] == "3.47"


def test_cache_round_trip_is_stable(tmp_path) -> None:
    out = tmp_path / "prices.json"
    PriceCache.load(SAMPLE).save(out)
    first = out.read_text()
    PriceCache.load(out).save(out)
    assert out.read_text() == first
    assert first.startswith('{\n  "_about"')
