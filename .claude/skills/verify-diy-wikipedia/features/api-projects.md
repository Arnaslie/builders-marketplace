# API projects and recommendations

The API serves the seeded project catalogue from `contract/fixtures/*.json`: a gallery list, a
full project with its materials-and-tools lines, and a route that accepts a community project
recommendation and returns it as a draft. JSON keys are camelCase; money is a two-decimal string.

## Sub-features

- `projects-list` `GET /projects` returns three summaries in this order: chair, knife, squat rack.
- `project-detail` `GET /projects/simple-wooden-chair` returns 12 lines mixing tools and materials.
- `project-404` an unknown slug returns `404`.
- `recommendation-draft` `POST /recommendations` returns `201` with `"status":"draft"`.
- `recommendation-strict` unknown request fields are rejected with `422`.

## How to get to it (user POV)

- The gallery page fetches `/projects`; a project page fetches `/projects/{slug}`.
- A "suggest a project" form posts to `/recommendations`.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0. Fixtures ship in the repo; nothing to seed.

- **List.** `$V api "$RUN" GET /projects api-projects`. Status `200`. Then
  `python3 -c 'import json,sys; b=json.load(open(sys.argv[1])); print([p["slug"] for p in b], b[0]["lineCount"], b[0]["estimatedTotal"])' .verify/$RUN/evidence/api-projects.body`
  prints `['simple-wooden-chair', 'forged-kitchen-knife', 'wooden-squat-rack'] 12 364.62`.
- **Detail.** `$V api "$RUN" GET /projects/simple-wooden-chair api-project-chair`. Status `200`. Then
  `python3 -c 'import json,sys; p=json.load(open(sys.argv[1])); m=p["materials"]; print(len(m), sorted({x["category"] for x in m}), m[0]["channel3ProductId"])' .verify/$RUN/evidence/api-project-chair.body`
  prints `12 ['material', 'tool'] None`.
- **404.** `$V api "$RUN" GET /projects/no-such-project api-project-404`. Status `404`.
- **Draft.** `$V api "$RUN" POST /recommendations api-recommendation '{"title":"Cedar Planter Box","summary":"Raised planter from cedar fence pickets.","materials":[{"name":"Cedar fence picket","qty":8,"unit":"board","category":"material"}]}'`.
  Status `201`; `grep -o '"status":"draft"' .verify/$RUN/evidence/api-recommendation.body` matches;
  `grep -o '"slug":"cedar-planter-box"'` matches.
- **Strict.** Same request with `,"price":"1.00"` added before the final `}` (name it
  `api-recommendation-extra`). Status `422`.

## Gotchas

- Recommendations are not stored yet: the draft is echoed with a fresh `id` and `createdAt` each
  time. Do not assert on those values.
- Squat rack and knife are stubs (`STUB:` in the summary, no steps). Only the chair is complete.
