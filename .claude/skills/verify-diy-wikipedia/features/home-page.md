# Home page

The home page is what a visitor sees at the site root: a page titled `DIY Wikipedia` with an
`<h1>DIY Wikipedia</h1>` heading and a paginated gallery of project cards (10 per page), each linking
to `/projects/<slug>`. Page-by-page proof for the other web routes is in [web-pages.md](./web-pages.md).

In fixture mode the gallery shows the 3 real fixtures followed by 47 mock projects from
`lib/mock/projects.ts` (50 total, pages 1-5; mock cards carry a `sample` tag). `?page=N` picks the
page (page 6+ is a 404), and `?view=classic|industrial|offgrid|postmodern` picks the UI proposal.

## Sub-features

- `home-render` returns 200 HTML with the `DIY Wikipedia` heading.
- `home-meta` sets the document title and meta description from `app/layout.tsx`.
- `home-gallery` lists ten cards per page, each linking to its project page.
- `home-pages` serves `/?page=1` to `/?page=5` and 404s `/?page=6`.
- `home-views` renders each of the four views with its `listing--<view>` wrapper class.
- `home-visual` renders visibly in a real browser.

## How to get to it (user POV)

- Open the site root `/` in a browser (the hosted Render URL or the local instance).

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.

- **Load the page.** Request `/`. Run `$V get "$RUN" / home`. `evidence/home.status` is `200`
  and `evidence/home.headers` has `content-type: text/html`.
- **Heading.** Run `grep -o '<h1>DIY Wikipedia</h1>' .verify/$RUN/evidence/home.body`. One match.
- **Metadata.** Run `grep -o '<title>DIY Wikipedia</title>' .verify/$RUN/evidence/home.body` and
  `grep -o 'Hands-on projects with a materials grid and a PayPal-powered shopping agent.' .verify/$RUN/evidence/home.body`.
  Both match (the description prints twice: once in `<meta>`, once in the RSC payload).
- **Gallery.** Run `grep -o 'href="/projects/[a-z0-9-]*"' .verify/$RUN/evidence/home.body | sort -u | wc -l`.
  Ten links, including `/projects/simple-wooden-chair`, `/projects/forged-kitchen-knife` and
  `/projects/wooden-squat-rack` (the real fixtures come first).
- **Pages.** Run `$V get "$RUN" "/?page=5" page5` and `$V get "$RUN" "/?page=6" page6`.
  `page5.status` is `200` with ten project links; `page6.status` is `404`.
- **Views.** For each of `industrial offgrid postmodern`, run `$V get "$RUN" "/?view=$v" view-$v`
  and run `grep -o 'class="listing listing--'"$v"'"' .verify/$RUN/evidence/view-$v.body`. One match
  each (anchored on the class attribute; a bare `listing--$v` also matches the RSC payload).
- **Browser proof of views and Lenis.** Run `$V drive "$RUN" listing-views`. It loads every view at
  1366 and 375 px wide and fails on: not 10 cards, horizontal overflow, console errors, `html.lenis`
  missing, or a wheel scroll that does not move the page. Screenshots land in
  `evidence/listing-<view>-<desktop|phone>.png`; look at them, because an empty proposal stylesheet
  would still pass the mechanical checks.
- **Proof.** Run `$V shot "$RUN" / home`. `evidence/home.png` shows the `DIY Wikipedia` heading
  and the first page of project cards.

## Gotchas

- `/` is dynamic (`ƒ` in the build output) because it reads `searchParams`. Still launch a fresh run
  after editing `app/` so the build matches the source.
- React 19 may emit the title inside `<head>` with extra attributes in future versions; grep
  for the text if the exact tag match ever fails, and note it here.
- The headless screenshot is taken after load; it proves rendering, not interactivity.
- Body text also appears inside the `self.__next_f.push(...)` RSC script, so a grep count is not a
  count of visible occurrences. For visibility, use the screenshot.
