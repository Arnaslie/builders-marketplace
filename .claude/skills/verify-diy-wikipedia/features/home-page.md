# Home page

The home page is what a visitor sees at the site root: a page titled `DIY Wikipedia` with an
`<h1>DIY Wikipedia</h1>` heading and a masonry gallery of project cards, each linking to
`/projects/<slug>`. Page-by-page proof for the other web routes is in [web-pages.md](./web-pages.md).

## Sub-features

- `home-render` returns 200 HTML with the `DIY Wikipedia` heading.
- `home-meta` sets the document title and meta description from `app/layout.tsx`.
- `home-gallery` lists one card per fixture project (three today), each linking to its project page.
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
- **Gallery.** Run `grep -o 'href="/projects/[a-z-]*"' .verify/$RUN/evidence/home.body | sort -u`.
  Three links: `/projects/forged-kitchen-knife`, `/projects/simple-wooden-chair`,
  `/projects/wooden-squat-rack`.
- **Proof.** Run `$V shot "$RUN" / home`. `evidence/home.png` shows the `DIY Wikipedia` heading
  and three project cards.

## Gotchas

- `/` is statically prerendered (`○` in the build output): a change only shows after a rebuild,
  so always launch a fresh run rather than reusing an old one after editing `app/`.
- React 19 may emit the title inside `<head>` with extra attributes in future versions; grep
  for the text if the exact tag match ever fails, and note it here.
- The headless screenshot is taken after load; it proves rendering, not interactivity.
- Body text also appears inside the `self.__next_f.push(...)` RSC script, so a grep count is not a
  count of visible occurrences. For visibility, use the screenshot.
