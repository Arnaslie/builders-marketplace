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

ASSUMPTION: Node.js / TypeScript. Update if the stack changes.

```bash
git clone <repo-url>
cd <repo>
cp .env.example .env     # then fill in the values
npm install
npm run dev              # TODO: confirm script names
```

Open http://localhost:3000.

Required environment variables are listed in `.env.example`: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV=sandbox`, `CHANNEL3_API_KEY`, `LLM_API_KEY`, and optional `AG_GRID_LICENSE_KEY`.

## Tech stack

- Node.js / TypeScript (assumption; framework TODO)
- [AG Grid](https://www.ag-grid.com/) for the materials grid
- [Channel3](https://trychannel3.com/developers) product search API
- [PayPal Orders v2](https://developer.paypal.com/) (sandbox)
- LLM provider: `TODO`
- Hosting: [Render](https://render.com/) via `render.yaml` Blueprint

## License

MIT, see [LICENSE](LICENSE). Copyright (c) 2026 DIY Wikipedia contributors.
