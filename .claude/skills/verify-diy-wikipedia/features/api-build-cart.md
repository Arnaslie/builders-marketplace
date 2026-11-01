# API shopping-agent cart

`POST /agent/build-cart` turns a project into a cart: it leaves out lines the user owns and, when
a budget is given and the cart is over it, swaps in each line's cheapest listed alternative,
largest saving first, until the cart fits. Each swap carries a reason. Deterministic code, no
LLM yet (`api/app/cart.py`).

## Sub-features

- `cart-owned-skip` ids in `owned` are left out and listed in `skippedLineIds`.
- `cart-budget-swaps` over budget, swaps apply biggest saving first and stop once within budget.
- `cart-budget-unreachable` if all swaps still miss the budget, `withinBudget` is `false` and no
  line is dropped.
- `cart-errors` unknown project `404`; unknown owned id `422`; a numeric (non-string) budget `422`.

## How to get to it (user POV)

- On a project page the user ticks owned tools, enters a budget and presses "Build my cart".

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.
- `OWNED='["chair-drill","chair-tape-measure","chair-safety-glasses"]'` (the chair's `ownedDefault` tools).

- **Owned skip, no budget.** `$V api "$RUN" POST /agent/build-cart api-cart-owned "{\"projectId\":\"proj-chair\",\"owned\":$OWNED}"`.
  Status `200`; body has `"subtotal":"250.67"`, `"swaps":[]`, `"withinBudget":true`, and
  `"skippedLineIds":["chair-drill","chair-tape-measure","chair-safety-glasses"]`.
- **Budget 200.** `$V api "$RUN" POST /agent/build-cart api-cart-200 "{\"projectId\":\"proj-chair\",\"owned\":$OWNED,\"budget\":\"200.00\"}"`.
  Status `200`; `"subtotal":"146.65"`, `"withinBudget":true`, one swap with `"lineId":"chair-miter-saw"`,
  `"savings":"104.02"`, and a `"reason"` containing `over the 200.00 budget`.
- **Budget 120.** Same with `"budget":"120.00"` (name `api-cart-120`). `"subtotal":"114.65"`; swaps
  in order `chair-miter-saw`, `chair-pocket-jig`, `chair-clamps`. Check order with
  `grep -o '"lineId":"[a-z0-9-]*","from"' .verify/$RUN/evidence/api-cart-120.body`.
- **Budget 50.** Same with `"budget":"50.00"` (name `api-cart-50`). `"subtotal":"107.65"`,
  `"withinBudget":false`, four swaps, nine lines.
- **Errors.** `$V api "$RUN" POST /agent/build-cart api-cart-404 '{"projectId":"nope"}'` -> `404`;
  `$V api "$RUN" POST /agent/build-cart api-cart-unknown-owned '{"projectId":"proj-chair","owned":["chair-hammer"]}'` -> `422`
  with `chair-hammer` in `detail`; `$V api "$RUN" POST /agent/build-cart api-cart-float '{"projectId":"proj-chair","budget":200}'` -> `422`.

## Gotchas

- The server ignores `ownedDefault`; only `owned` counts. The UI pre-ticks boxes from `ownedDefault`.
- Swap order is part of the contract (frontend shows it as the agent's reasoning). If the rule
  changes, update these expected values and `api/tests/test_cart.py` together.
