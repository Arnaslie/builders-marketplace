# Home page

The home page is what a visitor sees at the site root: a page titled `DIY Wikipedia`, styled after the
1994 CIA server page (white, Times, bevelled rules, seal floated right of "Welcome to the DIY Wikipedia
Server"), with an `<h1>DIY WIKIPEDIA MISSION</h1>` heading and a paginated project index (10 per page),
each row a banner plus title inside one link to `/projects/<slug>`. Page-by-page proof for the other
web routes is in [web-pages.md](./web-pages.md).

In fixture mode the gallery shows the 3 real fixtures followed by 47 mock projects from
`lib/mock/projects.ts` (50 total, pages 1-5; mock rows carry a `[SAMPLE LISTING]` tag). `?page=N`
picks the page (page 6+ is a 404). The old `?view=` proposals were retired; the parameter is ignored.

## Sub-features

- `home-render` returns 200 HTML with the `DIY WIKIPEDIA MISSION` heading.
- `home-meta` sets the document title and meta description from `app/layout.tsx`.
- `home-gallery` lists ten index rows per page, each linking to its project page.
- `home-pages` serves `/?page=1` to `/?page=5` and 404s `/?page=6`.
- `home-visual` renders the 1994 design visibly in a real browser on every page.

## How to get to it (user POV)

- Open the site root `/` in a browser (the hosted Render URL or the local instance).

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.

- **Load the page.** Request `/`. Run `$V get "$RUN" / home`. `evidence/home.status` is `200`
  and `evidence/home.headers` has `content-type: text/html`.
- **Heading.** Run `grep -o '<h1>DIY WIKIPEDIA MISSION</h1>' .verify/$RUN/evidence/home.body`. One match.
- **Metadata.** Run `grep -o '<title>DIY Wikipedia</title>' .verify/$RUN/evidence/home.body` and
  `grep -o 'Hands-on projects with a materials grid and a PayPal-powered shopping agent.' .verify/$RUN/evidence/home.body`.
  Both match (the description prints twice: once in `<meta>`, once in the RSC payload).
- **Gallery.** Run `grep -o 'href="/projects/[a-z0-9-]*"' .verify/$RUN/evidence/home.body | sort -u | wc -l`.
  Ten links, including `/projects/simple-wooden-chair`, `/projects/forged-kitchen-knife` and
  `/projects/wooden-squat-rack` (the real fixtures come first).
- **Pages.** Run `$V get "$RUN" "/?page=5" page5` and `$V get "$RUN" "/?page=6" page6`.
  `page5.status` is `200` with ten project links; `page6.status` is `404`.
- **Browser proof of the design and Lenis.** Run `$V drive "$RUN" listing-views`. It loads index
  pages 1 and 5, a project page and /recommend at 1366 and 375 px wide and fails on: missing seal or
  welcome line, not exactly one `<h1>`, a non-Times body font, a missing "Current Edition" dateline,
  horizontal overflow, console errors, `html.lenis` missing, and on index pages not 10 links/banners
  or a wheel scroll that does not move the page. Screenshots land in
  `evidence/site-<page>-<desktop|phone>.png`; look at them, because broken styling can still pass
  the mechanical checks.
- **Proof.** Run `$V shot "$RUN" / home`. `evidence/home.png` shows the masthead, the mission
  heading and the first page of the project index.

## Gotchas

- `/` is dynamic (`ƒ` in the build output) because it reads `searchParams`. Still launch a fresh run
  after editing `app/` so the build matches the source.
- React 19 may emit the title inside `<head>` with extra attributes in future versions; grep
  for the text if the exact tag match ever fails, and note it here.
- The headless screenshot is taken after load; it proves rendering, not interactivity.
- Body text also appears inside the `self.__next_f.push(...)` RSC script, so a grep count is not a
  count of visible occurrences. For visibility, use the screenshot.
