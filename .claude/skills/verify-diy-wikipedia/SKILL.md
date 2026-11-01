---
name: verify-diy-wikipedia
description: Launch, health-check, and drive the real DIY Wikipedia services in isolated production builds - the Next.js web app (home page, /healthz, 404) and the FastAPI API in api/ (projects, recommendations, build-cart, checkout stubs, PayPal webhook, OpenAPI contract) - and capture HTTP and screenshot evidence. Use to prove a change to app/, api/ or contract/ actually works in the running services, to reproduce the Render build/start lifecycles locally, or before claiming a page or route behaves a certain way.
---

# Verify DIY Wikipedia

DIY Wikipedia is two services in one repo:

- **web**: a Next.js 15 (App Router) app at the repo root. Browser surface: the placeholder home
  page at `/` (the future project gallery); HTTP: `/healthz` and Next's 404 page.
- **api**: a FastAPI service in `api/` (Python 3.12, uv). HTTP only: `/healthz`, `/projects`,
  `/projects/{slug}`, `/recommendations`, `/agent/build-cart`, `/checkout/orders`,
  `/checkout/orders/{id}/capture`, `/webhooks/paypal`, and `/openapi.json`, which must equal the
  committed `contract/openapi.json`. Data comes from `contract/fixtures/*.json`.

Both are Render web services in `render.yaml`. Not built yet: the gallery and AG Grid UI,
Channel3 pricing, the LLM part of the agent, and real PayPal calls (checkout routes are stubs).
Do not claim to verify those. When they land, add them to `features/` (see
`/pstack:maintain-verification-skill`).

All steps go through one helper, `.claude/skills/verify-diy-wikipedia/verify.sh` (run it from
the repo root). Its `--help`-style usage prints when run with no arguments.

## Launch

```bash
V=.claude/skills/verify-diy-wikipedia/verify.sh
RUN=$($V launch)            # or: RUN=$($V launch my-feature-check)
```

What it does, so you can debug it:

1. Copies the **working tree** (uncommitted edits included; excluding `.git`, `node_modules`,
   `.next`, `.venv`, `__pycache__`, `.pytest_cache`, `.env*` except `.env.example`, `.verify`) to
   `.verify/$RUN/app/`. The user's checkout, `.next/` and `api/.venv` are never touched, so a
   `npm run dev` or `uvicorn --reload` they have open keeps working.
2. Runs both Render build lifecycles from `render.yaml` in the copy: `npm ci && npm run build`
   (~10 s), then `cd api && uv sync --locked --no-dev` (fails if `api/uv.lock` is stale). Log in
   `.verify/$RUN/state/build.log`. Needs `uv` on PATH.
3. Starts `npm start` (= `next start -H 0.0.0.0`) with `PORT` set to the first free port in
   3100–3199 and `PAYPAL_ENV=sandbox`, in its own process group (`setsid`).
4. Starts `api/.venv/bin/uvicorn app.main:app --host 0.0.0.0` on the first free port in
   3200–3299, with `CORS_ALLOW_ORIGINS` set to the web origin of this run, in its own process
   group. Log in `.verify/$RUN/state/api.log`.
5. **Ready** = web `GET /healthz` returns `{"status":"ok"}` **and** web `GET /` contains
   `<h1>DIY Wikipedia</h1>` **and** api `GET /healthz` returns `{"status":"ok"}`. It polls up to
   30 s, then prints `RUN` on stdout and `ready: web http://127.0.0.1:<port>  api http://127.0.0.1:<api-port>`
   on stderr.

No database, seed data, or secrets are needed today: nothing reads `PAYPAL_*`, `CHANNEL3_API_KEY`,
`LLM_API_KEY`, or `AG_GRID_LICENSE_KEY` yet. Once code does, launch must pass them in (never
copy the user's `.env` into evidence).

Known noise: `npm ci` prints `EBADENGINE` because `package.json` pins `node >=20 <21` and
this machine may run a newer Node. That is a warning, not a failure. Render uses Node 20
(`NODE_VERSION=20`), so a Node-version-specific bug can still slip past a local run.

Isolation: every run gets its own copy, port, and process group, so several runs can coexist.
The server binds `0.0.0.0` (same as production); it is reachable on the LAN while running.

## Doctor

Run first, and whenever anything looks off:

```bash
$V doctor "$RUN"
```

Read-only. For **each** service (`web`, `api`): the recorded process group is alive; the port is
held by a process in **our** process group (not some other server that grabbed it); `/healthz`
returns exactly `{"status":"ok"} 200`. Plus: web's served HTML references the `BUILD_ID` in this
run's `.next/` (proves you are hitting the build you just made), and api's `/openapi.json` equals
this run's `contract/openapi.json` as parsed JSON (proves the committed contract is current).
Prints the source revision (`<sha>` or `<sha>+dirty`; untracked files count as dirty) and
evidence dir. Exit code 0 only if every line is `ok`. Never drive an instance whose doctor fails,
and never drive a server this skill did not start (e.g. the user's `npm run dev` on :3000 or
`uvicorn` on :8000).

## Drive

Server-rendered HTML is the stable handle: assert on text and tags in the response body.

```bash
$V url  "$RUN" /                    # http://127.0.0.1:<port>/
$V get  "$RUN" /        home        # -> evidence/home.{status,headers,body}
$V shot "$RUN" /        home        # -> evidence/home.png (headless Firefox, 1280x800)
curl -sS "$($V url "$RUN" /healthz)"

$V api-url "$RUN" /projects         # http://127.0.0.1:<api-port>/projects
$V api "$RUN" GET  /projects api-projects                       # -> evidence/api-projects.{status,headers,body}
$V api "$RUN" POST /agent/build-cart api-cart '{"projectId":"proj-chair"}'   # body also saved as .request
```

- `get` records the status code, response headers, and body; use it for every assertion
  you report, so the proof is on disk, not only in your terminal.
- `api` does the same against the API for any method; with a JSON body it sends
  `Content-Type: application/json` and saves the body as `evidence/NAME.request`.
- `shot` uses headless Firefox with a throwaway profile and `--no-remote`, so it never touches
  the user's browser session. It takes one full-load screenshot; it cannot click or type. When
  the app grows interactive features (grid editing, checkout popup), add a real browser driver
  (e.g. Playwright, not installed today) and record its recipe in the feature file.
- Per-feature recipes, with exact selectors and expected results, are in
  [`features/README.md`](features/README.md). Use the matching file; cover every entry point
  it lists.

## Evidence

Everything lands in `.verify/$RUN/evidence/` (gitignored; survives cleanup). Logs stay in
`.verify/$RUN/state/` (`build.log`, `server.log`, `source-rev`, `port`).

Proof standards:

- Exercise the real user path: a browser load or a plain HTTP request to a public route.
  No test-only endpoints, no importing components in Node.
- Capture the action and the resulting state: the request (`get` writes the path into its
  output line; quote it in your report) and the status, headers, and body that came back.
  A screenshot alone is not proof of a status code.
- Record the source revision from `doctor` with the proof; `+dirty` means uncommitted edits
  were part of what you tested.
- Side effects: none exist yet (no DB, no outbound calls; checkout orders live in API memory).
  When real checkout or Channel3 calls land, verify the PayPal sandbox order / Channel3 call
  actually happened (or provably did not), rather than trusting a "success" response.
- Mocks only at an existing production boundary (e.g. PayPal sandbox is itself the boundary;
  do not stub the app's own route handlers).

## Cleanup

```bash
$V cleanup "$RUN"
ls .verify/"$RUN"/evidence/        # proof must still be here
```

Kills only the process groups recorded in `.verify/$RUN/state/pid` and `state/api.pid` (TERM,
then KILL after 5 s), deletes the app copy and throwaway browser profiles, and keeps `evidence/`
and logs. Never `pkill next`/`pkill node`/`pkill uvicorn`: the user may have their own dev
servers running. Run cleanup after failed attempts too. To discard old evidence, delete
`.verify/<RUN>/` by hand once it has been reported.

If a launch died half-way (no `ready` line), `cleanup` still works as long as
the pid files exist; otherwise check `ps -eo pid,pgid,args | grep -E 'next-server|uvicorn'`
and kill only a process group whose cwd is under `.verify/`.

## Helpers

| Command | Purpose |
| --- | --- |
| `verify.sh launch [RUN_ID]` | copy, install, build, start web + api; prints `RUN_ID` |
| `verify.sh doctor RUN_ID` | read-only health + identity check of both services |
| `verify.sh url RUN_ID [PATH]` | print web URL |
| `verify.sh api-url RUN_ID [PATH]` | print API URL |
| `verify.sh get RUN_ID PATH NAME` | web HTTP GET → `evidence/NAME.{status,headers,body}` |
| `verify.sh api RUN_ID METHOD PATH NAME [JSON]` | API request → `evidence/NAME.{request,status,headers,body}` |
| `verify.sh shot RUN_ID PATH NAME` | screenshot → `evidence/NAME.png` |
| `verify.sh cleanup RUN_ID` | stop both servers, delete app copy, keep evidence |

`VERIFY_ROOT=/some/dir` overrides `.verify/`.
