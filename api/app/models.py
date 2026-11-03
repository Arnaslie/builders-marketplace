"""Contract models for the DIY Wikipedia API (issue #1).

Every model in this file is part of the public contract. FastAPI turns them into
contract/openapi.json (api/scripts/export_openapi.py), and the frontend generates its
TypeScript types from that file. Change a model here, re-export, commit both.

Conventions:
- Python attributes are snake_case; JSON on the wire is camelCase (``ContractModel``).
- Money is a decimal *string* with two decimals ("24.99"), never a float. That is the format
  PayPal Orders v2 uses for ``amount.value``, so a cart total passes straight to checkout
  without float rounding.
- Response fields have no defaults, so generated TS types mark them required (nullable
  fields are ``T | null``, not optional).
- PayPal shapes keep PayPal's own snake_case names (``PayPalModel``) so they can be compared
  1:1 with PayPal's docs.
"""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Price = Annotated[
    str,
    Field(
        pattern=r"^\d{1,7}\.\d{2}$",
        description="Decimal amount as a string with exactly two decimals (PayPal amount.value format).",
        examples=["24.99"],
    ),
]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$", description="ISO 4217 code.", examples=["USD"])]
Category = Literal["tool", "material"]
Difficulty = Literal["beginner", "intermediate", "advanced"]


class ContractModel(BaseModel):
    """Base for our own models: snake_case in Python, camelCase in JSON, unknown keys rejected."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        validate_by_name=True,
        validate_by_alias=True,
        serialize_by_alias=True,
        extra="forbid",
    )


class PayPalModel(BaseModel):
    """Base for PayPal Orders v2 shapes: field names exactly as PayPal sends them."""


# --- Catalogue -----------------------------------------------------------------------------


class ProductOption(ContractModel):
    """One purchasable product: the default pick for a line, or a cheaper alternative."""

    channel3_product_id: str | None = Field(description="Channel3 product id; null until the Channel3 client fills it in.")
    name: str
    price: Price = Field(description="Unit price.")
    currency: Currency
    retailer: str
    product_url: str
    image_url: str | None


class MaterialLine(ContractModel):
    """One row of a project's materials-and-tools grid."""

    id: str = Field(description="Stable within its project; used by owned[] and swaps.")
    name: str
    qty: int = Field(ge=1)
    unit: str = Field(examples=["board", "pack", "each"])
    category: Category
    channel3_product_id: str | None
    price: Price = Field(description="Unit price of the default product.")
    currency: Currency
    retailer: str
    product_url: str
    image_url: str | None
    owned_default: bool = Field(description="UI default for the 'I own this' checkbox. The server only trusts owned[].")
    alternatives: list[ProductOption] = Field(description="Cheaper products the agent may swap in to meet a budget.")


class Project(ContractModel):
    id: str
    slug: str
    status: Literal["published", "draft"]
    title: str
    summary: str
    difficulty: Difficulty
    estimated_hours: int = Field(ge=1)
    image_url: str | None
    currency: Currency
    steps: list[str]
    materials: list[MaterialLine]


class ProjectSummary(ContractModel):
    """Gallery card: a Project without its steps and materials."""

    id: str
    slug: str
    title: str
    summary: str
    difficulty: Difficulty
    estimated_hours: int
    image_url: str | None
    line_count: int
    estimated_total: Price = Field(description="Sum of qty x price over every line, owned or not.")
    currency: Currency


# --- Recommendations (community-submitted project drafts) -----------------------------------


class DraftLine(ContractModel):
    """A material or tool as a contributor describes it: no prices yet (Channel3 fills them in)."""

    name: str = Field(min_length=1)
    qty: int = Field(ge=1)
    unit: str
    category: Category


class RecommendationRequest(ContractModel):
    title: str = Field(min_length=3, max_length=120)
    summary: str = Field(max_length=2000)
    steps: list[str] = Field(default_factory=list)
    materials: list[DraftLine] = Field(min_length=1)


class Recommendation(ContractModel):
    id: str
    status: Literal["draft"]
    slug: str
    title: str
    summary: str
    steps: list[str]
    materials: list[DraftLine]
    created_at: datetime


# --- Shopping agent cart --------------------------------------------------------------------


class BuildCartRequest(ContractModel):
    project_id: str
    owned: list[str] = Field(default_factory=list, description="MaterialLine ids the user already has; left out of the cart.")
    budget: Price | None = Field(default=None, description="Optional cap on the cart subtotal, in the project currency.")


class CartLine(ContractModel):
    line_id: str
    name: str
    category: Category
    qty: int
    unit_price: Price
    line_total: Price
    currency: Currency
    retailer: str
    product_url: str
    channel3_product_id: str | None
    swapped: bool = Field(description="True when this line uses a cheaper alternative (see swaps).")


class Swap(ContractModel):
    line_id: str
    from_: ProductOption = Field(alias="from")
    to: ProductOption
    reason: str
    savings: Price = Field(description="Saving on the whole line (unit saving x qty).")


class Cart(ContractModel):
    project_id: str
    currency: Currency
    lines: list[CartLine]
    swaps: list[Swap]
    skipped_line_ids: list[str] = Field(description="Lines left out because the user owns them.")
    subtotal: Price
    budget: Price | None
    within_budget: bool = Field(description="subtotal <= budget; always true when no budget was given.")


# --- Checkout -------------------------------------------------------------------------------


class Order(ContractModel):
    """Our record of a checkout. The app is merchant of record; retailer fulfilment is simulated."""

    id: str
    paypal_order_id: str
    paypal_capture_id: str | None
    project_id: str
    status: Literal["created", "paid"]
    fulfilment: Literal["simulated"]
    total: Price
    currency: Currency
    lines: list[CartLine]


class CheckoutConfig(ContractModel):
    """What the browser needs to load the PayPal JS SDK. The client id is public by design."""

    client_id: str = Field(description="PayPal REST client id for the JS SDK script tag (not a secret).")
    currency: Currency
    env: Literal["sandbox", "live"]


class PayPalAmount(PayPalModel):
    currency_code: Currency
    value: Price


class PayPalPurchaseUnit(PayPalModel):
    reference_id: str
    amount: PayPalAmount


class PayPalLink(PayPalModel):
    href: str
    rel: str
    method: str


class PayPalOrder(PayPalModel):
    """Subset of the PayPal Orders v2 create-order response the frontend needs (id for the JS SDK)."""

    id: str
    intent: Literal["CAPTURE"]
    status: Literal["CREATED", "APPROVED", "COMPLETED"]
    purchase_units: list[PayPalPurchaseUnit]
    links: list[PayPalLink]


# --- Ops ------------------------------------------------------------------------------------


class Health(ContractModel):
    status: Literal["ok"]


class WebhookAck(ContractModel):
    received: Literal[True]
