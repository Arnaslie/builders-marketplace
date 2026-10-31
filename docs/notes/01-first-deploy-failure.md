# 01 — First deploy failure: ENOENT on package.json

## What happened
Render ran our build command (`npm install && npm run build`) and failed with
`ENOENT: no such file or directory, open '/opt/render/project/src/package.json'`.

`/opt/render/project/src` is where Render checked out our repo. Render runs build and start
commands relative to the service's root directory, which defaults to the repo root [3].
Our repo root holds only `LICENSE`, `README.md`, `.env.example`, `render.yaml` and
`.gitignore`. There is no `package.json`, so `npm` had nothing to install or build.
The host was fine; the app did not exist yet.

## Why we reproduce locally first
Before touching Render again, we run the same lifecycle on our own machine:

```
npm ci && npm run build && npm start
```

- `npm ci` installs exactly what `package-lock.json` pins and fails if the lockfile is missing or stale.
- `npm run build` is the step that failed on Render.
- `npm start` proves the server boots, binds a port, and answers `/healthz`.

Local failures take seconds to fix. Render failures cost a full deploy cycle.

## Next.js vs Vite + Express
| | Next.js (App Router) | Vite + Express |
|---|---|---|
| Build | one `next build` | client build plus server build |
| Serve | one `next start` process | Express serves the API and the built static files |
| API routes | Route Handlers in the same app | Express routes |
| Tradeoff | more framework conventions to learn | more wiring and two pipelines to keep in sync |

Next.js is the default: one build and one start command fit a single Render web service. Vite + Express works, but needs two pipelines in one service.

## `/healthz` and `process.env.PORT`
- **PORT:** a Render web service must bind to `0.0.0.0` on the port in the `PORT` env var, which defaults to `10000` [1]. Render's own example uses `process.env.PORT || 4000` [1]. Env var values are always strings [4].
- **/healthz:** `healthCheckPath: /healthz` turns on HTTP health checks. A 2xx/3xx response within five seconds counts as healthy [2]. A new deploy only receives traffic once its instances pass, and Render cancels the deploy if they do not pass within 15 minutes [2]. The app must actually serve this route.

## Sources (fetched 2026-10-31)
1. https://render.com/docs/web-services (Port binding)
2. https://render.com/docs/health-checks
3. https://render.com/docs/monorepo-support (Root-relative settings)
4. https://render.com/docs/environment-variables
