"""Unit tests for the deterministic cart rules in app/cart.py, using the chair fixture.

Chair numbers (all USD): full project 364.62; owned-default tools (drill 99.00, tape 9.97,
glasses 4.98) bring it to 250.67. Cheapest alternatives and line savings:
miter saw 104.02, pocket jig 20.00, clamps 12.00, polyurethane 7.00.
"""

import pytest

from app.cart import UnknownLineError, build_cart
from app.store import FixtureStore, fixtures_dir

OWNED = ["chair-drill", "chair-tape-measure", "chair-safety-glasses"]


@pytest.fixture(scope="module")
def chair():
    return FixtureStore.from_dir(fixtures_dir()).by_id("proj-chair")


def test_no_owned_no_budget_buys_everything(chair) -> None:
    cart = build_cart(chair, [], None)
    assert len(cart.lines) == 12
    assert cart.subtotal == "364.62"
    assert cart.swaps == []
    assert cart.within_budget is True


def test_owned_lines_are_skipped(chair) -> None:
    cart = build_cart(chair, OWNED, None)
    assert cart.subtotal == "250.67"
    assert cart.skipped_line_ids == OWNED
    assert not {line.line_id for line in cart.lines} & set(OWNED)


def test_budget_already_met_means_no_swaps(chair) -> None:
    cart = build_cart(chair, OWNED, "300.00")
    assert cart.swaps == []
    assert cart.subtotal == "250.67"
    assert cart.within_budget is True


def test_largest_saving_first_and_stop_when_within_budget(chair) -> None:
    cart = build_cart(chair, OWNED, "120.00")
    assert [s.line_id for s in cart.swaps] == ["chair-miter-saw", "chair-pocket-jig", "chair-clamps"]
    assert cart.subtotal == "114.65"
    assert cart.within_budget is True
    swapped = {line.line_id for line in cart.lines if line.swapped}
    assert swapped == {"chair-miter-saw", "chair-pocket-jig", "chair-clamps"}
    saw = next(line for line in cart.lines if line.line_id == "chair-miter-saw")
    assert saw.unit_price == "24.98"
    assert saw.name == "Miter box with 14 in back saw"


def test_cheapest_alternative_is_chosen(chair) -> None:
    cart = build_cart(chair, OWNED, "200.00")
    assert cart.swaps[0].to.price == "24.98"  # miter box, not the 59.00 circular saw
    assert "over the 200.00 budget" in cart.swaps[0].reason


def test_unreachable_budget_applies_all_swaps_and_reports(chair) -> None:
    cart = build_cart(chair, OWNED, "50.00")
    assert len(cart.swaps) == 4
    assert cart.subtotal == "107.65"
    assert cart.within_budget is False
    assert len(cart.lines) == 9  # nothing the project needs is dropped


def test_unknown_owned_id_raises(chair) -> None:
    with pytest.raises(UnknownLineError) as exc:
        build_cart(chair, ["chair-hammer"], None)
    assert exc.value.line_ids == ["chair-hammer"]


def test_line_totals_use_qty(chair) -> None:
    pine = next(line for line in build_cart(chair, [], None).lines if line.line_id == "chair-pine-2x2")
    assert (pine.qty, pine.unit_price, pine.line_total) == (3, "3.28", "9.84")
