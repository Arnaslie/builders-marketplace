# API health and contract

The FastAPI service (`api/`) answers `GET /healthz` for Render's health check and serves its
OpenAPI document at `GET /openapi.json`. That document must equal the committed
`contract/openapi.json`, which the frontend generates its TypeScript types from.

## Sub-features

- `api-healthz-ok` returns `200` with body exactly `{"status":"ok"}` as JSON.
- `api-contract-match` the served `/openapi.json` equals `contract/openapi.json` (parsed JSON).
- `api-cors` allows the configured frontend origin (`CORS_ALLOW_ORIGINS`) and no other.

## How to get to it (user POV)

- Render's health checker requests `GET /healthz` on the API service port.
- A frontend developer regenerates types from `contract/openapi.json`; the browser calls the API
  cross-origin from the Next.js site.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0 (it already checks `api /healthz` and the contract match; the steps
  below save the evidence).

- **Health.** Run `$V api "$RUN" GET /healthz api-healthz`. `evidence/api-healthz.status` is `200`;
  `cat .verify/$RUN/evidence/api-healthz.body` prints exactly `{"status":"ok"}`;
  `grep -i '^content-type' .verify/$RUN/evidence/api-healthz.headers` reads `content-type: application/json`.
- **Contract.** Run `$V api "$RUN" GET /openapi.json api-openapi`, then
  `python3 -c 'import json,sys; sys.exit(json.load(open(sys.argv[1]))!=json.load(open(sys.argv[2])))' .verify/$RUN/evidence/api-openapi.body contract/openapi.json && echo same`.
  Prints `same`. (Compare against the repo file only when the run's source revision is not `+dirty`
  for `contract/`, otherwise compare against `.verify/$RUN/app/contract/openapi.json` before cleanup.)
- **CORS allowed.** Run
  `curl -sS -o /dev/null -D - -X OPTIONS -H "Origin: $($V url "$RUN")" -H 'Access-Control-Request-Method: POST' -H 'Access-Control-Request-Headers: content-type' "$($V api-url "$RUN" /agent/build-cart)" | grep -i '^access-control-allow-origin'`.
  It echoes the web origin (`http://127.0.0.1:<web port>`).
- **CORS refused.** Same command with `-H 'Origin: https://evil.example'`. Status `400`, no
  `access-control-allow-origin` line.

## Gotchas

- `launch` sets `CORS_ALLOW_ORIGINS` to the run's own web origin; on Render it must be set to the
  deployed Next.js URL (`render.yaml`, `sync: false`).
- A stale `contract/openapi.json` fails doctor. Fix with `cd api && uv run python scripts/export_openapi.py`
  and commit the file; never hand-edit it.
- API ports are 3200-3299 (web uses 3100-3199).
