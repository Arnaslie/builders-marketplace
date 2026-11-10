# What it costs to change the app name / URL

Written 2026-11-10 (station clock). Repo: `/home/arnas/Desktop/Coding/builders-marketplace`
(branch `ns/20261109-readme-judges-sandbox-checkout-guide`, HEAD `fd89349`).
Every count below came from `git grep` on the tracked tree; every price from a cited page.

Two costs, and they are separable: the **name** (what people read) and the **URL**
(what people click). The name is free. The URL splits into a free path and a paid path.

---

## 1. The name — $0, about 30 minutes

`DIY Wikipedia` appears in **16 tracked files, 22 lines**. Nothing outside the repo
depends on it, so a rename is a text sweep plus one rebuild.

| File | Lines |
|---|---|
| `app/layout.tsx` | 10 title, 29 aria-label, 33 "Welcome to the DIY Wikipedia Server" |
| `app/page.tsx` | 35 `<h3>DIY Wikipedia Projects...</h3>` |
| `app/cart/page.tsx` | 8 page title, 132 checkout copy |
| `app/checkout/success/page.tsx` | 5 page title |
| `app/projects/[slug]/page.tsx` | 16 page title |
| `app/recommend/page.tsx` | 3 page title |
| `components/seal.tsx` | 3 comment, 35 `aria-label="Seal of the DIY Wikipedia Builders Marketplace"` |
| `api/app/main.py` | 1 docstring, 406 FastAPI `title` |
| `api/app/__init__.py` | 1 docstring |
| `api/app/models.py` | 1 docstring |
| `api/pyproject.toml` | 4 description |
| `contract/openapi.json` | 4 `info.title` |
| `README.md` | 1 heading, 129 licence line |
| `LICENSE` | 3 copyright holder |
| `docs/solo-plan.md` | 1 heading |
| `render.yaml` | 1 comment |

**Two that are not ordinary text:**

- `contract/openapi.json` is the **committed contract**, and `api/tests/test_routes.py`
  asserts the app's live schema matches it. Renaming `api/app/main.py`'s `title` without
  regenerating the JSON turns `test_committed_contract_matches_app` red. Regenerate with
  `npm run gen:types` after editing, or leave both titles alone.
- `LICENSE:3` "Copyright (c) 2026 DIY Wikipedia contributors" — the party named in an MIT
  licence. If your GitHub account is the real copyright holder, that line is a separate,
  small correctness fix worth making while you are in there.

**Not a repo cost, but the clock cost:** the name is baked into the submission video as
pixels — `video/card-title.png` ("PAYPAL AI HACKATHON / DIY Wikipedia") and
`video/card-end.png` ("LIVE DEMO + SOURCE IN THE DESCRIPTION / DIY Wikipedia"), with the
card scripts in `video/card.py`. Renaming after those cards are rendered means re-running
`card.py` and re-assembling via `reel-final.json` (`reel-demo.json` also uses
`card-title.png`). Both cards render from `card.py`, so it is a re-render, not a redesign.

Also counted: 24 hits under `video-submission/docs/` and 4 in `.verify/` clones. The docs
hits are mostly VO lines and captions; `.verify/` are disposable copies and cost nothing.

---

## 2. The URL — free path: $0, about 15 minutes of dashboard work

Live, verified today with `curl`:

- `https://diy-wikipedia.onrender.com/healthz` → **HTTP 200 in 0.50 s**
- `https://diy-wikipedia-api.onrender.com/healthz` → **HTTP 200 in 32.8 s** (cold start, exactly the spin-down the README warns judges about)

Render assigns the `onrender.com` subdomain from the **service name** in `render.yaml`
(`diy-wikipedia`, `diy-wikipedia-api`), and **you cannot edit that subdomain after the
service exists.** That is a long-standing Render feature request, open since 2019, last
merged into a duplicate in May 2021, still unimplemented, with 44 votes —
https://feedback.render.com/features/p/ability-to-change-onrendercom-sub-domain
(read 2026-11-10). One commenter's workaround was to delete and recreate the service.

So the free path is: **rename `name:` in `render.yaml`, then create two new Render
services, and delete the old two.** New subdomains, no money.

What that costs in practice:

- **Two new free services**; same plan, same commands, secrets are `sync: false` so
  Render prompts again on first Blueprint sync. Nothing to re-buy.
- **The sleep penalty restarts on the new API service** — the 32.8 s wake you paid above
  is what judges would see, and a brand-new cold service is no warmer than that.
- **`NEXT_PUBLIC_API_URL` must be repointed** (`render.yaml:22`). Next inlines
  `NEXT_PUBLIC_*` at **build** time, so this is a rebuild, not a restart — the file says so
  itself.
- **`CORS_ALLOW_ORIGINS` on the API service must be updated in the Render dashboard** (it
  is `sync: false`, so it is not in `render.yaml`). Miss this and the web app loads but the
  agent and checkout calls fail in the browser — the exact failure mode of "the page works,
  the cart does not".
- **Break the video and the judges' guide at the same time**: the old URLs are printed in
  `README.md:9,25`, `docs/solo-plan.md:90`, `api/tests/test_routes.py:172,174,175` and
  `video-submission/docs/*`. Deleting the old services kills the links already written into
  the submission docs, and the old hostnames are **not** recoverable by anyone else at that
  moment only because you released them — someone else can claim them.

## 3. The URL — paid path: a custom domain

From https://render.com/docs/custom-domains (read 2026-11-10): the Hobby workspace
includes **2 custom domains**; beyond that each costs **$0.25/month**. TLS certs are
automatic and free, and services keep their `onrender.com` subdomain alongside the custom
one. Today's Hobby plan page lists **Custom domains** as an included Hobby feature and
Hobby at **$0/mo**, so with two services you would use exactly two of the two included
domains — Render's own figure for the third and beyond is $0.25/mo.
(https://render.com/pricing, read 2026-11-10)

What is *not* $0 is the domain itself, which Render does not sell. A `.com` is roughly
**$10–15/year** retail (registrar-, first-year- and promotion-dependent; I have not quoted
a live registrar page, so treat that number as a planning figure, not a verified one).

Then, once per new domain (about 10–20 minutes): add it in the Dashboard → set DNS
(a CNAME for a subdomain, an A/ALIAS for an apex) → **click Verify** (verification can need
a retry while DNS propagates) → Render issues TLS. Remove any AAAA records first; Render is
IPv4-only and the docs call AAAA records a source of unexpected behaviour.

**The paid path is the one that keeps every existing link alive**, because the
`onrender.com` addresses stay working next to the new domain. For a submission whose
deadline is Thursday Nov 12, that is the whole argument for it.

---

## 4. The recommendation

Two different jobs, two different answers:

1. **Renaming the product? Do it now, and do not touch the URLs.** The name costs ~30
   minutes and one rebuild, all inside the repo. Do the name now while the video cards are
   still cards rather than a finished upload.
2. **Changing the URLs two days before the deadline is the expensive move** — not in
   dollars, in failure modes: new cold services, a build-time `NEXT_PUBLIC_API_URL`
   repoint, a dashboard-only CORS var, and every link you have already written going dead.
   If you want a better address, buy the domain and add it as a custom domain on the
   **existing** services. Then `diy-wikipedia.onrender.com` keeps serving and nothing you
   have already shipped breaks.

There is also a reason to change the name beyond taste: the producer package's own open-risk
note flags that "Wikipedia" is a third-party trademark sitting in the product name, and
notes that renaming the VO would not remove it from the header, the "Welcome to the DIY
Wikipedia Server" line, or the `diy-wikipedia.onrender.com` address — which is exactly the
list above. A name change plus a custom domain is the only combination that clears all
three.

**One caveat I will not paper over:** if you recreate the services to get a free new
subdomain, none of the old hostnames are yours afterwards, and you must re-wake and
re-test the whole demo path (agent cart → PayPal sandbox → capture) on the new ones before
you record. That re-test is the real cost, and it is time, not money.

## Sources

- Live URL probes: `curl -s -o /dev/null -w '%{http_code} %{time_total}'`, 2026-11-10
- https://render.com/docs/custom-domains — included domains (Hobby 2 / Pro 15 / Scale 25),
  $0.25/mo beyond, apex vs subdomain DNS, verification, Render subdomain toggle
- https://render.com/docs/blueprint-spec — `render.yaml` service fields (`name`)
- https://render.com/pricing — Hobby $0/mo, custom domains listed as a Hobby feature
- https://feedback.render.com/features/p/ability-to-change-onrendercom-sub-domain — the
  onrender.com subdomain cannot be renamed after creation (open since 2019)
