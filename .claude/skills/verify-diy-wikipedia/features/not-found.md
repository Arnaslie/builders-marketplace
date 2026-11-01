# Not found page

A visitor who opens a path that does not exist gets Next.js's built-in 404 page with an HTTP 404
status, not a 200 or a crash. The app has no custom `not-found.tsx` yet.

## Sub-features

- `404-status` returns HTTP `404` for an unknown path.
- `404-page` renders the default "This page could not be found." page inside the app layout.

## How to get to it (user POV)

- Type or follow a link to a non-existent path, e.g. `/projects/does-not-exist`.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0.
- `/projects/does-not-exist` is not a fixture slug. `/projects/[slug]` exists and calls
  `notFound()` for it, so the 404 comes from the project page's `notFound()`.

- **Request.** Run `$V get "$RUN" /projects/does-not-exist notfound`. `evidence/notfound.status`
  is `404`.
- **Page text.** Run `grep -o 'This page could not be found' .verify/$RUN/evidence/notfound.body`.
  One match.
- **Layout applied.** Run `grep -o '<html lang="en"' .verify/$RUN/evidence/notfound.body`. One match.
- **Proof.** Run `$V shot "$RUN" /projects/does-not-exist notfound`. `evidence/notfound.png` shows
  `404` and `This page could not be found.`

## Gotchas

- The screenshot cannot show the status code; the `get` status file is the proof of `404`.
- When a custom `app/not-found.tsx` is added, update the expected text here.
- `/projects/no-such-project` is the same case, driven in [web-pages.md](./web-pages.md).
