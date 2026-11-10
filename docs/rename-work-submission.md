# Rename job handoff: DIY Wikipedia → Builders Marketplace

**Submitted to:** SOFTWARE · BUILD & TEST line (p588), stages ENGINEER → TESTER → REVIEWER
**Described by:** L, on the host. Every claim below is labelled **measured** (L ran it, output quoted)
or **read** (inferred from the code/git, command named).
**Repo:** `/home/arnas/Desktop/Coding/builders-marketplace`
**Branch / HEAD at description time:** `ns/20261109-readme-judges-sandbox-checkout-guide` @ `fd89349`

---

## 1. What the job is

The app was renamed from **DIY Wikipedia** to **Builders Marketplace**. The rename is already applied to
the working tree. This job is **not** to redo it and **not** to invent new scope:

* **build/fix:** make the rename complete and consistent in the code and docs it claims to cover;
* **test:** check it against the acceptance criteria in section 4, including the things it deliberately
  did not touch;
* **review:** re-derive independently, label every finding **measured** or **read**, and end with one
  verdict line.

## 2. What changed (read: `git status --porcelain`, 19 modified tracked files)

Modified, all name-level:

| Area | Files |
|---|---|
| Next.js pages / metadata | `app/layout.tsx`, `app/page.tsx`, `app/cart/page.tsx`, `app/checkout/success/page.tsx`, `app/projects/[slug]/page.tsx`, `app/recommend/page.tsx` |
| Seal | `components/seal.tsx` |
| API | `api/app/__init__.py`, `api/app/main.py`, `api/app/models.py`, `api/app/channel3.py` |
| Contract + packaging | `contract/openapi.json`, `api/pyproject.toml`, `api/uv.lock` |
| Legal / docs / config | `LICENSE`, `README.md`, `docs/solo-plan.md`, `render.yaml`, `.gitignore` |

Representative lines (read):

* `app/layout.tsx:10` `title: "Builders Marketplace"`; `:29` `aria-label="Builders Marketplace home"`;
  `:33` `Welcome to the Builders Marketplace Server`
* `app/page.tsx:35` `<h3>Builders Marketplace Projects...</h3>`
* `api/app/main.py:406` `title="Builders Marketplace API"` → regenerated into `contract/openapi.json:4`
* `LICENSE:3` `Copyright (c) 2026 Builders Marketplace contributors`
* `components/seal.tsx:54` top arc `BUILDERS`; `:59` bottom arc `BUILDERS MARKETPLACE`

**Seal detail worth verifying, not assuming:** the old seal's top white arc read `DIY WIKIPEDIA` while its
gold band already read `BUILDERS MARKETPLACE`. The top arc is now `BUILDERS` and the two band repeats were
collapsed to one. Layout, colours, arcs and the compass star were not redesigned.

## 3. What was deliberately NOT changed, and why (this is a requirement, not an oversight)

1. **URL and service names are untouched.** `render.yaml:7` `name: diy-wikipedia`, `:44` `name: diy-wikipedia-api`;
   the `*.onrender.com` URLs in `README.md`, `docs/solo-plan.md:90` and `api/tests/test_routes.py:172-175`
   still name the old host. Render derives the `onrender.com` host from `name:` and it **cannot be edited
   after the service exists**, so renaming the Blueprint entry would not rename the live service.
   **Do not "fix" these to a new URL.** They are correct as-is while the services keep their hostnames.
2. **`.claude/skills/verify-diy-wikipedia/` keeps its path.** The engineers' Dossier Purposes, `.gitignore`
   and the merge gate all reference it; renaming it would break the gate for a cosmetic win.
3. **`video-submission/` still says "DIY Wikipedia"** (e.g. `video/card.py:2`, the scripts, the producer
   package, `card-title.png` / `card-end.png` pixels). This is **known-open, out of scope for this job, and
   has a clock**: the video has to be re-shot/re-rendered before the PayPal submission. Treat it as a
   reported gap, never as a pass.

## 4. Acceptance criteria (TESTER and REVIEWER: number these and mark each PASS / FAIL / UNVERIFIED)

1. No user-visible string in the app says "DIY Wikipedia" (built output checked, not just source).
2. `LICENSE:3` and `README.md` name *Builders Marketplace contributors*, not the old party.
3. `api/app/main.py` OpenAPI title is `Builders Marketplace API` **and** `contract/openapi.json` is
   regenerated so `test_committed_contract_matches_app` passes (contract drift is the classic trap here).
4. `components/seal.tsx` renders `BUILDERS` (top arc) + `BUILDERS MARKETPLACE` (bottom arc) with no stray
   duplicated text block, and the seal's geometry (arcs, colours, star) is unchanged.
5. `api/pyproject.toml` name/description and `api/app/channel3.py`'s user agent reflect the new name.
6. The URL is still `diy-wikipedia.onrender.com` / `diy-wikipedia-api.onrender.com` in every file, and
   `render.yaml` service names are unchanged — i.e. criterion 1 was **not** over-applied.
7. `docs/solo-plan.md` and `README.md` still describe the hosted demo at the *existing* URL.

## 5. Measured state at description time (L ran these on the host)

| Command | Result |
|---|---|
| `cd api && uv run pytest -q` | **110 passed, 1 skipped** in 0.41s |
| `npx tsc --noEmit` | **clean, exit 0** |
| `npx vitest run --exclude '**/.worktrees/**'` | **1 file, 4 passed** |
| `npm run build` | **7/7 static pages** (previous pass on this tree) |

**Known false signal — do not report these as product failures:** a bare `npm test` / `npx vitest run`
walks into `.worktrees/` (nine git worktrees, eight stale copies of the suite) and shows
**28 failed / 394 passed**. There is no `vitest.config.ts`, so exclusion is not yet committed. Real result
is the excluded run above. *The commander may apply that config; if it lands, this bullet is stale.*

## 6. What is NOT proven

* Live Render services and the PayPal sandbox were **not** touched: needs real secrets, and the free-plan API
  cold-starts ~33s (measured earlier: web `/healthz` 200 in 0.50s, api `/healthz` 200 in 32.8s).
* The Playwright e2e specs and `scripts/verify.sh` did not run in the describing pass.
* The rename is **uncommitted** (`git status` shows 19 modified files, no commit) — it exists only in the
  working tree on `fd89349`.
