"""Channel3 client (app/channel3.py) against a fake transport: no network, no credits."""

import json
import logging
import urllib.request
from decimal import Decimal

import pytest

from app.channel3 import Channel3AuthError, Channel3Client, Channel3Error, parse_search_response

KEY = "sk-test-not-a-real-key"

# Shaped like the SearchResponse / Product / ProductOffer / Price schemas in
# https://channel3.mintlify.dev/docs/api-reference/v1/search.md
SEARCH_RESPONSE = {
    "products": [
        {
            "id": "p1",
            "title": "Kreg Pocket-Hole Jig 320",
            "images": [
                {"url": "https://img.example.com/side.jpg", "is_main_image": False},
                {"url": "https://img.example.com/main.jpg", "cleaned_url": "https://cdn.example.com/main.png",
                 "is_main_image": True},
            ],
            "offers": [
                {"url": "https://buy.example.com/a", "domain": "www.homedepot.com",
                 "price": {"price": 39.98, "compare_at_price": None, "currency": "USD"},
                 "availability": "InStock", "condition": "new", "max_commission_rate": 0.03},
                {"url": "https://buy.example.com/b", "domain": "lowes.com",
                 "price": {"amount": 41, "currency": "usd"}, "availability": "OutOfStock"},
                {"url": "https://buy.example.com/c", "domain": "broken.com", "price": {"currency": "USD"}},
            ],
        },
        {"id": "", "title": "no id, dropped"},
    ],
    "next_page_token": None,
}


class FakeSend:
    def __init__(self, status: int = 200, body: object = SEARCH_RESPONSE) -> None:
        self.status = status
        self.body = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.requests: list[tuple[urllib.request.Request, float]] = []

    def __call__(self, request: urllib.request.Request, timeout: float) -> tuple[int, bytes]:
        self.requests.append((request, timeout))
        return self.status, self.body


def test_search_request_matches_the_docs() -> None:
    send = FakeSend()
    Channel3Client(KEY, timeout=7.5, send=send).search("Kreg pocket hole jig 320", limit=99)
    (request, timeout), = send.requests
    assert request.full_url == "https://api.trychannel3.com/v1/search"
    assert request.get_method() == "POST"
    assert request.get_header("X-api-key") == KEY  # urllib capitalizes header names
    assert request.get_header("Content-type") == "application/json"
    assert json.loads(request.data) == {
        "query": "Kreg pocket hole jig 320",
        "limit": 30,  # clamped to the documented max
        "config": {"country": "US", "currency": "USD"},
    }
    assert timeout == 7.5


def test_parses_products_offers_and_images() -> None:
    products = Channel3Client(KEY, send=FakeSend()).search("jig")
    assert [p.id for p in products] == ["p1"]
    product = products[0]
    assert product.image_url == "https://cdn.example.com/main.png"  # main image, cleaned variant
    assert [(o.domain, o.price, o.currency, o.availability) for o in product.offers] == [
        ("www.homedepot.com", Decimal("39.98"), "USD", "InStock"),
        ("lowes.com", Decimal("41"), "USD", "OutOfStock"),  # price.amount variant from the Offer guide
    ]


def test_image_falls_back_to_first_url() -> None:
    [product] = parse_search_response({"products": [{"id": "x", "title": "t", "images": [{"url": "https://a/1.jpg"}]}]})
    assert product.image_url == "https://a/1.jpg"
    [product] = parse_search_response({"products": [{"id": "x", "title": "t"}]})
    assert product.image_url is None and product.offers == ()


@pytest.mark.parametrize("status", [401, 402])
def test_auth_and_credit_errors_stop(status: int) -> None:
    send = FakeSend(status, {"detail": "You have used all of your free credits."})
    with pytest.raises(Channel3AuthError) as exc:
        Channel3Client(KEY, send=send).search("x")
    assert exc.value.status == status
    assert KEY not in str(exc.value)


def test_other_errors_raise_without_the_key(caplog) -> None:
    caplog.set_level(logging.DEBUG)
    with pytest.raises(Channel3Error) as exc:
        Channel3Client(KEY, send=FakeSend(500, b"<html>oops</html>")).search("x")
    assert exc.value.status == 500
    assert not isinstance(exc.value, Channel3AuthError)
    assert KEY not in str(exc.value)
    assert KEY not in caplog.text


def test_non_json_200_is_an_error() -> None:
    with pytest.raises(Channel3Error):
        Channel3Client(KEY, send=FakeSend(200, b"not json")).search("x")


def test_key_never_in_repr() -> None:
    assert KEY not in repr(Channel3Client(KEY, send=FakeSend()))


def test_from_env(monkeypatch) -> None:
    monkeypatch.delenv("CHANNEL3_API_KEY", raising=False)
    with pytest.raises(Channel3Error, match="CHANNEL3_API_KEY is not set"):
        Channel3Client.from_env()
    monkeypatch.setenv("CHANNEL3_API_KEY", f"  {KEY}\n")
    send = FakeSend()
    Channel3Client.from_env(send=send).search("x")
    assert send.requests[0][0].get_header("X-api-key") == KEY
