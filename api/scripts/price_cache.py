"""Fill contract/prices.json with one Channel3 search per fixture material line (issues #11, #4).

Each search costs 1 Channel3 credit and the project has a fixed budget, so the script is built
to be re-run safely:

- Lines already in the cache (priced, or recorded as a miss) are skipped unless --refresh.
- Lines that share a search phrase (the drill, safety glasses...) cost one call, not three.
- The cache is saved after every call, so a crash or Ctrl-C keeps what was paid for.
- A 401/402 (bad key, no credits) stops the run at once.
- --max-calls caps the spend of a single run.

Run from api/ (the key comes from the environment; never pass it on the command line):

    uv run python scripts/price_cache.py --dry-run          # plan only: no key, no calls
    uv run --env-file ../.env python scripts/price_cache.py # price every unpriced line
    uv run --env-file ../.env python scripts/price_cache.py --refresh --line chair-drill

"Best match" = the highest-ranked Channel3 product that has a usable offer (in stock, new or
unknown condition, project currency, http(s) link), and that product's cheapest such offer.
Channel3 ranks by relevance, so relevance wins over price across products.
"""

import argparse
import json
import sys
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Protocol

API_DIR = Path(__file__).resolve().parents[1]
CONTRACT = API_DIR.parent / "contract"
DEFAULT_QUERIES = CONTRACT / "channel3-queries.json"

sys.path.insert(0, str(API_DIR))  # so "app" imports when run as scripts/price_cache.py

from app.cart import CENT  # noqa: E402
from app.channel3 import (  # noqa: E402
    MAX_PRICE,
    Channel3AuthError,
    Channel3Client,
    Channel3Error,
    Offer,
    Product,
    pick_best,
    retailer_name,
)
from app.prices import DEFAULT_PRICES_FILE, PriceCache, PriceEntry, PriceMiss  # noqa: E402
from app.store import DEFAULT_FIXTURES_DIR, load_projects  # noqa: E402

# A match more than this many times above or below the fixture's authored price is almost always a
# different product (a mortar mixer for "mortar", a LEGO brick for "bricks"). It is recorded as a
# miss, so the line keeps its authored price. --max-ratio 0 turns the guard off.
SUSPECT_RATIO = 4


class Searcher(Protocol):
    """What the script needs from Channel3Client; tests pass a fake."""

    def search(self, query: str) -> list[Product]: ...


@dataclass
class Job:
    project_id: str
    line_id: str
    query: str
    currency: str
    fixture_price: str


def plan(
    fixtures: Path, queries_file: Path, cache: PriceCache, projects: set[str], lines: set[str], refresh: bool
) -> tuple[list[Job], int]:
    """Jobs to run, and how many lines were skipped because they are already cached."""
    queries = json.loads(queries_file.read_text(encoding="utf-8"))
    queries.pop("_about", None)
    jobs, skipped = [], 0
    for project in load_projects(fixtures):
        if project.id not in projects:
            continue
        for line in project.materials:
            if lines and line.id not in lines:
                continue
            query = (queries.get(line.id) or "").strip()
            if not query:
                raise SystemExit(f"no Channel3 query for {line.id} in {queries_file}")
            cached = cache.entry(project.id, line.id) or cache.miss(project.id, line.id)
            if cached is not None and not refresh:
                skipped += 1
                continue
            jobs.append(Job(project.id, line.id, query, project.currency, line.price))
    return jobs, skipped


def run(args: argparse.Namespace, make_client: Callable[[], Searcher]) -> int:
    out: Path = args.out
    cache = PriceCache.load(out)
    if args.reject_file:
        return reject(args, cache)
    known = {p.id for p in load_projects(args.fixtures)}
    unknown = set(args.project or []) - known
    if unknown:
        print(f"unknown project id(s): {sorted(unknown)}", file=sys.stderr)
        return 2
    projects = set(args.project or known)
    jobs, skipped = plan(args.fixtures, args.queries, cache, projects, set(args.line or []), args.refresh)
    unique = list(dict.fromkeys(job.query for job in jobs))

    print(f"{len(jobs)} line(s) to price, {skipped} already cached, {len(unique)} Channel3 call(s) "
          f"({len(unique)} credit(s)); cap {args.max_calls}")
    if args.dry_run:
        for job in jobs:
            print(f"  would search  {job.project_id}/{job.line_id}: {job.query!r}")
        return 0
    if not jobs:
        return 0
    if len(unique) > args.max_calls:
        print(f"refusing: {len(unique)} calls exceeds --max-calls {args.max_calls}", file=sys.stderr)
        return 2

    client = make_client()
    results: dict[str, list[Product] | Exception] = {}
    priced = missed = failed = suspect = 0
    for job in jobs:
        if job.query not in results:
            try:
                results[job.query] = client.search(job.query)
            except Channel3AuthError as exc:
                cache.save(out)
                print(f"stopping: {exc}", file=sys.stderr)
                return 3
            except Channel3Error as exc:
                results[job.query] = exc
        result = results[job.query]
        now = datetime.now(UTC).replace(microsecond=0)
        if isinstance(result, Exception):
            # Not cached: a transient failure should be retried on the next run.
            failed += 1
            print(f"  FAILED  {job.line_id}: {result}", file=sys.stderr)
            continue

        best = pick_best(result, job.currency)
        if best is None:
            missed += 1
            cache.put_miss(job.project_id, job.line_id, PriceMiss(
                query=job.query, fetched_at=now,
                reason=f"{len(result)} product(s), none with an in-stock new {job.currency} offer",
            ))
            print(f"  miss    {job.line_id}: {job.query!r}")
        else:
            product, offer = best
            price = str(offer.price.quantize(CENT))
            fixture = Decimal(job.fixture_price)
            ratio = Decimal(price) / fixture if fixture else Decimal(SUSPECT_RATIO + 1)
            limit = args.max_ratio
            if limit and not Decimal(1) / limit <= ratio <= limit:
                suspect += 1
                cache.put_miss(job.project_id, job.line_id, PriceMiss(
                    query=job.query, fetched_at=now,
                    reason=f"suspect match {product.title!r} at {price} {offer.currency} is {ratio:.2f}x "
                           f"the fixture price {job.fixture_price}",
                ))
                print(f"  suspect {job.line_id}: {price} {offer.currency} {product.title!r} "
                      f"is {ratio:.2f}x fixture {job.fixture_price}; kept fixture price")
            else:
                cache.put(job.project_id, job.line_id, PriceEntry(
                    channel3_product_id=product.id, title=product.title, price=price, currency=offer.currency,
                    retailer=retailer_name(offer.domain), url=offer.url, image_url=product.image_url,
                    fetched_at=now, query=job.query,
                ))
                priced += 1
                print(f"  priced  {job.line_id}: {price} {offer.currency} at {retailer_name(offer.domain)} "
                      f"(fixture {job.fixture_price}) {product.title!r}")
        cache.save(out)

    print(f"done: {priced} priced, {missed} miss(es), {suspect} suspect, {failed} failed, "
          f"{len(results)} call(s) made; wrote {out}")
    return 1 if failed else 0


def reject(args: argparse.Namespace, cache: PriceCache) -> int:
    """Record reviewed wrong-product matches as misses, so those lines keep their fixture price.

    The price guard only catches matches far off the authored price; a lumber crayon priced like
    a 2x6 gets through. A reviewer lists those in a JSON file {lineId: reason}. No Channel3 calls.
    """
    reasons: dict[str, str] = json.loads(args.reject_file.read_text(encoding="utf-8"))
    queries = json.loads(args.queries.read_text(encoding="utf-8"))
    owner = {line.id: project.id for project in load_projects(args.fixtures) for line in project.materials}
    unknown = sorted(set(reasons) - set(owner))
    if unknown:
        print(f"unknown line id(s) in {args.reject_file}: {unknown}", file=sys.stderr)
        return 2
    now = datetime.now(UTC).replace(microsecond=0)
    for line_id, reason in reasons.items():
        cache.put_miss(owner[line_id], line_id, PriceMiss(
            query=queries[line_id], fetched_at=now, reason=f"rejected by review: {reason}",
        ))
    cache.save(args.out)
    print(f"rejected {len(reasons)} line(s); wrote {args.out}")
    return 0


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="print the plan; no key needed, no calls, no write")
    parser.add_argument("--refresh", action="store_true", help="re-search lines that are already cached")
    parser.add_argument("--project", action="append", help="limit to a project id (repeatable); default: every fixture")
    parser.add_argument("--line", action="append", help="limit to a material line id (repeatable)")
    parser.add_argument("--max-calls", type=int, default=60, help="refuse to run if more calls are needed")
    parser.add_argument("--max-ratio", type=Decimal, default=Decimal(SUSPECT_RATIO),
                        help="record a match this many times off the fixture price as a miss; 0 disables")
    parser.add_argument("--reject-file", type=Path,
                        help="JSON {lineId: reason}: record these reviewed wrong matches as misses, no calls")
    parser.add_argument("--out", type=Path, default=DEFAULT_PRICES_FILE)
    parser.add_argument("--queries", type=Path, default=DEFAULT_QUERIES)
    parser.add_argument("--fixtures", type=Path, default=DEFAULT_FIXTURES_DIR)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None, make_client: Callable[[], Searcher] = Channel3Client.from_env) -> int:
    try:
        return run(parse_args(argv), make_client)
    except Channel3Error as exc:  # e.g. CHANNEL3_API_KEY not set
        print(str(exc), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
