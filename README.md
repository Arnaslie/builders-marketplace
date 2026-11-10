# Builders Marketplace

> A Pinterest-style catalogue of hands-on projects (furniture, gym equipment, forged knives). Every project page carries a materials-and-tools grid with prices and where to buy, and an AI agent can build your cart and check out with PayPal.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## Hosted demo

- **Live URL:** `https://diy-wikipedia.onrender.com`
- Note: free Render instances may spin down when idle; the first request can be slow.

## Features

- Browse project ideas (seeded: chair, squat rack, knife) in a Pinterest-style gallery.
- Per-project **AG Grid** table of materials and tools: quantity, price, retailer, buy link.
- Real prices and product matches from the **Channel3** product search API (prices come from a committed cache, not a live scrape).
- **Shopping agent**: builds the cart from the grid, skips tools you already own, swaps cheaper items within your budget.
- **PayPal Orders v2 (sandbox)** checkout. In this demo the app acts as merchant of record; retailer fulfilment is simulated. No real money moves.

## Try the checkout (PayPal sandbox)

Sandbox only: no real money moves and nothing ships.

**1. Wake the API first.** The API runs on Render's free plan, which spins it down when idle and can take
up to about 50 seconds to wake. Open https://diy-wikipedia-api.onrender.com/healthz and wait for a
response before you start. While the API is asleep, the gallery and project pages fall back to seed
data and still load, but building a cart and paying need the live API. If a page shows "SERVER ERROR",
wait a few seconds and click **Try again**.

**2. Build a cart with the agent.** Open any project from the gallery (for example the chair). In the
agent panel, optionally enter a budget and tick the items under **Already own**, then click
**Build my cart**. The agent returns the cart with any cheaper swaps and the reason for each.

**3. Go to the cart.** Click **Go to the cart and pay with PayPal**. The cart page re-prices the cart on
the server; the PayPal total always comes from the API, never from the browser.

**4. Pay in the PayPal popup.** Under **Pay with PayPal**, click the PayPal button. In the popup:

1. Enter the sandbox buyer email below, click **Next**, enter the password, click **Log In**.
2. On the review page, **confirm the payment method**: keep or select the PayPal balance or card, and if
   PayPal offers installments choose **pay in full**. This step is easy to miss; the payment is not
   approved until you confirm it.
3. Click the final button (**Continue**, **Complete Purchase** or **Pay Now**, depending on the page
   PayPal shows). The popup closes.

**5. Check the result.** The app captures the payment and opens `/checkout/success`, showing
**Order received** with status `paid` and the total. The demo API keeps orders in memory, so an order
page may show "Order not found" after the API restarts or sleeps; the payment itself is still visible
in the sandbox buyer's PayPal activity.

| Role | Email | Password |
|------|-------|----------|
| Sandbox buyer (public PayPal sandbox account, judges only, no real money) | `PASTE_JUDGE_SANDBOX_BUYER_EMAIL` | `PASTE_JUDGE_SANDBOX_BUYER_PASSWORD` |

About these credentials: this is a dedicated sandbox buyer created only for judging, not an account the
team develops or tests with. Anyone who reads this README can log in as it, so it holds nothing we
need, a password shared with no other account, and a sandbox balance we can reset or delete after
judging without touching our own test history or the e2e test's buyer. It is not the app's Client
Secret, which never appears in this repo.

<!-- Maintainers: create the account in the PayPal Developer Dashboard, Testing Tools > Sandbox Accounts
(type Personal, give it a balance), then replace the two PASTE_ placeholders above. -->

## Run locally

Two services: the Next.js web app at the repo root and the FastAPI API in `api/`.
Prerequisites: Node.js 20 and [uv](https://docs.astral.sh/uv/) (uv installs Python 3.12 if needed).

```bash
git clone https://github.com/Arnaslie/builders-marketplace.git
cd builders-marketplace
cp .env.example .env     # then fill in the values
```

Web (http://localhost:3000):

```bash
npm ci
npm run dev              # production: npm run build && npm start
```

API (http://localhost:8000, interactive docs at http://localhost:8000/docs):

```bash
cd api
uv sync                                      # creates api/.venv from api/uv.lock
uv run uvicorn app.main:app --reload --port 8000
uv run pytest                                # tests
uv run python scripts/export_openapi.py      # regenerate contract/openapi.json after model changes
```

The API allows browser calls from `CORS_ALLOW_ORIGINS` (comma-separated; default
`http://localhost:3000`).

### API contract

`contract/openapi.json` is the agreed API contract (issue #1), generated from the Pydantic models
in `api/app/models.py`. The frontend generates TypeScript types from it with `npm run gen:types`
(which writes `lib/api/schema.d.ts`). Seed data lives in `contract/fixtures/`, one file per project;
the API reads every `*.json` in that directory, so adding a project is a new file, not a code change.
Change a model, re-export, and commit both files together; `api/tests` and the verification skill
fail if they drift.

Required environment variables are listed in `.env.example`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`, `CHANNEL3_API_KEY`, `LLM_API_KEY`, and optional `AG_GRID_LICENSE_KEY`.

## Deploy (Render)

`render.yaml` defines two web services:

| Service | Build | Start | Health |
|---|---|---|---|
| `diy-wikipedia` (Next.js) | `npm ci && npm run build` | `npm start` | `/healthz` |
| `diy-wikipedia-api` (FastAPI) | `pip install uv==0.12.24 && cd api && uv sync --locked --no-dev` | `cd api && .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port $PORT` | `/healthz` |

Set the API's `CORS_ALLOW_ORIGINS` to the web service's public URL in the Render dashboard.

## Tech stack

- Next.js 15 (App Router) on Node 20 for the web app
- Python 3.12, FastAPI and Pydantic v2 for the API, managed with uv
- [AG Grid](https://www.ag-grid.com/) Community (the `ag-grid-community` and `ag-grid-react` packages) for the materials grid; Enterprise mode needs `AG_GRID_LICENSE_KEY`
- [Channel3](https://trychannel3.com/developers) product search API
- [PayPal Orders v2](https://developer.paypal.com/) (sandbox)
- LLM provider: [Anthropic Claude](https://docs.anthropic.com/) (key in `LLM_API_KEY`)
- Hosting: [Render](https://render.com/) via `render.yaml` Blueprint

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 Builders Marketplace contributors.
