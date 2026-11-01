# DIY Wikipedia verification map

This directory is the maintained source for verifying the user-facing behavior of DIY Wikipedia.
Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `RUN=$(.claude/skills/verify-diy-wikipedia/verify.sh launch)` from the repo root.
  Each run builds its own copy of the working tree on its own port (3100–3199).
- `V=.claude/skills/verify-diy-wikipedia/verify.sh` in every snippet below.
- `$V doctor "$RUN"` exits 0 before any drive step.
- No seed data, secrets, or external services are needed for the features mapped today.
- Never drive an instance that was not started by this verification run (in particular not
  the user's `npm run dev` on port 3000).

## Driving conventions

- HTTP actions go through `$V get "$RUN" <path> <name>`; assertions read the saved
  `evidence/<name>.status`, `.headers`, `.body`.
- Visual actions go through `$V shot "$RUN" <path> <name>` (headless Firefox, load only, no
  clicks). Interactive features need a real browser driver added to the skill first.
- Assert on rendered text and tags (`<h1>DIY Wikipedia</h1>`, `<title>`), never on hashed
  chunk filenames or the build id.
- Treat every command as literal.

## Proof and skip reporting

- Capture the request and the resulting status, headers, and body, not only a screenshot.
- UI proof includes a screenshot with the `DIY Wikipedia` heading visible.
- Record the run's source revision (printed by `doctor`) and the feature ID with every artifact.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a README-described feature (gallery, materials grid, shopping agent, PayPal
  checkout) as verified: none exist in `app/` yet.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior.
It then uses exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with verify.sh` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Home page](./home-page.md) covers the landing page at `/` (title, heading, placeholder copy).
- [Health check](./health-check.md) covers `/healthz`, the route Render gates deploys on.
- [Not found page](./not-found.md) covers the 404 response for unknown paths.

## Not yet built (from README; add a file when code lands)

- Project gallery (Pinterest-style grid of seeded projects: chair, squat rack, knife).
- Project page with AG Grid materials-and-tools table (quantity, price, retailer, buy link).
- Channel3 live pricing / product matches.
- Shopping agent that builds the cart within a budget.
- PayPal Orders v2 sandbox checkout.
