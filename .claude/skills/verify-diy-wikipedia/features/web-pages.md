# Web pages

The web app serves a project gallery at `/` (see [home-page.md](./home-page.md)), a project page
at `/projects/<slug>` with a hero, an AG Grid materials-and-tools table and the build steps, a
placeholder cart, a checkout success page, and a recommend-a-project form. Unknown project slugs
return the 404 page.

## Sub-features

- `project-page` returns 200 for `/projects/simple-wooden-chair` with the title, summary, grid
  container and steps.
- `project-grid` renders the AG Grid materials table with a running total below it.
- `project-404` returns HTTP `404` for `/projects/no-such-project`.
- `cart-page` returns 200 with the empty-cart placeholder.
- `checkout-success` returns 200 with `Fulfilment simulated for demo`.
- `recommend-form` returns 200 with the recommendation form (no API URL: previews the draft locally).

## How to get to it (user POV)

- Click a card on `/`, or open `/projects/simple-wooden-chair` directly.
- Use the header links: Browse (`/`), Recommend a project (`/recommend`), Cart (`/cart`).
- `/checkout/success` is where checkout will land after payment; today it is only reachable by URL.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.
- The run was launched without `NEXT_PUBLIC_API_URL`, so pages read `contract/fixtures/*.json`.

- **Project page.** Run `$V get "$RUN" /projects/simple-wooden-chair project`. `evidence/project.status`
  is `200`. Then each of these has a match in `evidence/project.body`:
  `grep -o '<h1>Simple Wooden Chair</h1>'`, `grep -o 'Materials and tools'`,
  `grep -o 'id="materials-grid"'`, `grep -o 'Sand from 80 to 220 grit'`.
- **Grid proof.** Run `$V shot "$RUN" /projects/simple-wooden-chair project`. `evidence/project.png`
  shows the title, a table with 12 rows (columns Item, Category, Qty, Unit, Unit price, Retailer,
  Already own it, Line total) and `Total to buy: $` below it. With the fixture defaults the drill,
  tape measure and safety glasses are ticked as owned, and the total is `$250.67`
  (3x3.28 + 2x4.98 + 4.97 + 6.98 + 8.97 + 15.98 + 39.99 + 129.00 + 24.98).
- **Unknown project.** Run `$V get "$RUN" /projects/no-such-project project404`.
  `evidence/project404.status` is `404`, and `grep -o 'This page could not be found'` on the
  body has one match.
- **Cart.** Run `$V get "$RUN" /cart cart`. Status `200`; `grep -o '<h1>Cart</h1>'` matches.
- **Checkout success.** Run `$V get "$RUN" /checkout/success success`. Status `200`;
  `grep -o 'Fulfilment simulated for demo'` matches. Screenshot:
  `$V shot "$RUN" /checkout/success success`.
- **Recommend form.** Run `$V get "$RUN" /recommend recommend`. Status `200`;
  `grep -o '<h1>Recommend a project</h1>'` matches and `grep -o 'Preview draft'` matches
  (the button label when no API URL is set). Screenshot: `$V shot "$RUN" /recommend recommend`.
- **Every route above** also gets a `shot` for PR evidence: `/`, `/projects/simple-wooden-chair`,
  `/cart`, `/checkout/success`, `/recommend`.

## Gotchas

- AG Grid renders in the browser. The `get` body contains the grid container and the row data
  inside the `self.__next_f.push(...)` RSC script, but not the rendered rows: a grep for an item
  name proves the data reached the page, not that a row is visible. Use the screenshot for that.
- The screenshot is a load-only capture. Editing a quantity, ticking `Already own it`, and the total
  recomputing are NOT covered: that needs a real browser driver (e.g. Playwright, not installed).
  Do not report them as verified from `get`/`shot` alone.
- The expected `$250.67` is for the unedited fixture; recompute it if `chair.json` changes.
- `/projects/[slug]` returns 404 through `notFound()`. Adding a `loading.tsx` can flush a 200
  status before `notFound()` runs; if the status ever changes, check for one.
- A new fixture file must be added to the import list in `lib/api/client.ts`, or it will not show up
  in the web app even though the API serves it.
