---
name: verify-diy-wikipedia
description: Launch, health-check, and drive the real DIY Wikipedia Next.js web app (home gallery page, /healthz, 404 page) in an isolated production build, and capture HTTP and screenshot evidence. Use to prove a change to app/ actually works in the running app, to reproduce the Render build/start lifecycle locally, or before claiming a page or route behaves a certain way.
---

# Verify DIY Wikipedia

DIY Wikipedia is a Next.js 15 (App Router) web app in this repo. The primary surface is the
browser: today that is the placeholder home page at `/` (the future project gallery). Secondary
surfaces are HTTP: `/healthz` (Render's health check, `render.yaml` → `healthCheckPath`) and
Next's built-in 404 page. The README describes planned features (project pages with an AG Grid
materials table, Channel3 pricing, an LLM shopping agent, PayPal sandbox checkout) that **do
not exist in the code yet**; do not claim to verify them. When they land, add them to
`features/` (see `/pstack:maintain-verification-skill`).

All steps go through one helper, `.claude/skills/verify-diy-wikipedia/verify.sh` (run it from
the repo root). Its `--help`-style usage prints when run with no arguments.

## Launch

```bash
V=.claude/skills/verify-diy-wikipedia/verify.sh
RUN=$($V launch)            # or: RUN=$($V launch my-feature-check)
```

What it does, so you can debug it:

1. Copies the **working tree** (uncommitted edits included; excluding `.git`, `node_modules`,
   `.next`, `.env*` except `.env.example`, `.verify`) to `.verify/$RUN/app/`. The user's checkout
   and their `.next/` are never touched, so a `npm run dev` they have open keeps working.
2. Runs the Render lifecycle from `render.yaml` in the copy: `npm ci && npm run build`
   (~10 s; log in `.verify/$RUN/state/build.log`).
3. Starts `npm start` (= `next start -H 0.0.0.0`) with `PORT` set to the first free port in
   3100–3199 and `PAYPAL_ENV=sandbox`, in its own process group (`setsid`).
4. **Ready** = `GET /healthz` returns `{"status":"ok"}` **and** `GET /` contains
   `<h1>DIY Wikipedia</h1>`. It polls up to 30 s, then prints `RUN` on stdout and
   `ready: http://127.0.0.1:<port>` on stderr.

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

Read-only. Checks: the recorded process group is alive; the port is held by a process in
**our** process group (not some other server that grabbed it); `/healthz` returns exactly
`{"status":"ok"} 200`; the served HTML references the `BUILD_ID` in this run's `.next/`
(proves you are hitting the build you just made). Prints the source revision (`<sha>` or
`<sha>+dirty`) and evidence dir. Exit code 0 only if every line is `ok`. Never drive an instance
whose doctor fails, and never drive a server this skill did not start (e.g. the user's
`npm run dev` on :3000).

## Drive

Server-rendered HTML is the stable handle: assert on text and tags in the response body.

```bash
$V url  "$RUN" /                    # http://127.0.0.1:<port>/
$V get  "$RUN" /        home        # -> evidence/home.{status,headers,body}
$V shot "$RUN" /        home        # -> evidence/home.png (headless Firefox, 1280x800)
curl -sS "$($V url "$RUN" /healthz)"
```

- `get` records the status code, response headers, and body; use it for every assertion
  you report, so the proof is on disk, not only in your terminal.
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
- Side effects: none exist yet (no DB, no outbound calls). When checkout or the agent lands,
  verify the PayPal sandbox order / Channel3 call actually happened (or provably did not),
  rather than trusting a "success" page.
- Mocks only at an existing production boundary (e.g. PayPal sandbox is itself the boundary;
  do not stub the app's own route handlers).

## Cleanup

```bash
$V cleanup "$RUN"
ls .verify/"$RUN"/evidence/        # proof must still be here
```

Kills only the process group recorded in `.verify/$RUN/state/pid` (TERM, then KILL after 5 s),
deletes the app copy and throwaway browser profiles, and keeps `evidence/` and logs. Never
`pkill next`/`pkill node`: the user may have their own dev server running. Run cleanup after
failed attempts too. To discard old evidence, delete `.verify/<RUN>/` by hand once it has been
reported.

If a launch died half-way (no `ready` line), `cleanup` still works as long as
`.verify/$RUN/state/pid` exists; otherwise check `ps -eo pid,pgid,args | grep next-server`
and kill only a process group whose cwd is under `.verify/`.

## Helpers

| Command | Purpose |
| --- | --- |
| `verify.sh launch [RUN_ID]` | copy, install, build, start; prints `RUN_ID` |
| `verify.sh doctor RUN_ID` | read-only health + identity check |
| `verify.sh url RUN_ID [PATH]` | print URL |
| `verify.sh get RUN_ID PATH NAME` | HTTP GET → `evidence/NAME.{status,headers,body}` |
| `verify.sh shot RUN_ID PATH NAME` | screenshot → `evidence/NAME.png` |
| `verify.sh cleanup RUN_ID` | stop our server, delete app copy, keep evidence |

`VERIFY_ROOT=/some/dir` overrides `.verify/`.
