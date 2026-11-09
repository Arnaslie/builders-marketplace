# DIY Wikipedia

> A Pinterest-style catalogue of hands-on projects (furniture, gym equipment, forged knives). Every project page carries a materials-and-tools grid with prices and where to buy, and an AI agent can build your cart and check out with PayPal.

Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/).

## Hosted demo

- **Live URL:** `TODO: https://<service>.onrender.com`
- Note: free Render instances may spin down when idle; the first request can be slow. `TODO: confirm plan`

## Features

- Browse project ideas (seeded: chair, squat rack, knife) in a Pinterest-style gallery.
- Per-project **AG Grid** table of materials and tools: quantity, price, retailer, buy link.
- Live pricing and product matches from the **Channel3** product search API.
- **Shopping agent**: builds the cart from the grid, skips tools you already own, swaps cheaper items within your budget.
- **PayPal Orders v2 (sandbox)** checkout. In this demo the app acts as merchant of record; retailer fulfilment is simulated. No real money moves.

## PayPal sandbox test credentials

Judges: log in at the PayPal checkout popup with the sandbox buyer below. Sandbox only; no real funds.

| Role | Email | Password |
|------|-------|----------|
| Sandbox buyer (personal) | `TODO: sb-xxxx@personal.example.com` | `TODO` |

`TODO (infra dev): paste buyer credentials from the PayPal Developer Dashboard, Testing Tools > Sandbox Accounts. Do NOT paste the app Client Secret here.`

## Run locally

Two services: the Next.js web app at the repo root and the FastAPI API in `api/`.
Prerequisites: Node.js 20 and [uv](https://docs.astral.sh/uv/) (uv installs Python 3.12 if needed).

```bash
git clone <repo-url>
cd <repo>
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
in `api/app/models.py`. The frontend generates TypeScript types from it, e.g.
`npx openapi-typescript contract/openapi.json -o app/lib/api-types.ts`. Seed data lives in
`contract/fixtures/*.json`. Change a model, re-export, and commit both files together;
`api/tests` and the verification skill fail if they drift.

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
- [AG Grid](https://www.ag-grid.com/) for the materials grid
- [Channel3](https://trychannel3.com/developers) product search API
- [PayPal Orders v2](https://developer.paypal.com/) (sandbox)
- LLM provider: [Anthropic Claude](https://docs.anthropic.com/) (key in `LLM_API_KEY`)
- Hosting: [Render](https://render.com/) via `render.yaml` Blueprint

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 DIY Wikipedia contributors.
