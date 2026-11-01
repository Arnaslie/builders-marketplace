# Health check

`/healthz` tells Render the service is up. Render only routes traffic to a deploy once this path
returns 2xx/3xx within 5 s, and cancels the deploy if it never does (`render.yaml`
`healthCheckPath`, `docs/notes/01-first-deploy-failure.md`).

## Sub-features

- `healthz-ok` returns `200` with body exactly `{"status":"ok"}` as JSON.
- `healthz-dynamic` is rendered on every request (not a stale prerender).
- `healthz-port` answers on whatever `PORT` the platform sets.

## How to get to it (user POV)

- Render's health checker requests `GET /healthz` on the service port.
- An operator runs `curl https://<service>.onrender.com/healthz`.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.

- **Request.** Run `$V get "$RUN" /healthz healthz`. `evidence/healthz.status` is `200`.
- **Body.** Run `cat .verify/$RUN/evidence/healthz.body`. Output is exactly `{"status":"ok"}`.
- **Content type.** Run `grep -i '^content-type' .verify/$RUN/evidence/healthz.headers`.
  It reads `content-type: application/json`.
- **Dynamic.** Run `grep -iE '^(cache-control|x-nextjs-cache)' .verify/$RUN/evidence/healthz.headers`.
  No output: a prerendered route would carry `s-maxage`/`x-nextjs-cache`; this one is generated
  per request. Then request twice and compare `Date:` headers; they differ.
- **Port from env.** Run `cat .verify/$RUN/state/port`; the request above went to that port,
  which `launch` passed only through `PORT`. Proves `npm start` honours `$PORT` as Render requires.
- **Latency.** Run `curl -sS -o /dev/null -w '%{time_total}\n' "$($V url "$RUN" /healthz)"`.
  Well under `5` seconds.

## Gotchas

- A local pass does not prove Render passes: Render uses Node 20 and port 10000 by default.
  Confirm on the hosted URL after deploy when the change touches startup.
- `doctor` already calls `/healthz`; that check is a precondition, not the proof. Use `get` so the
  status and headers are saved.
