"""Write the API's OpenAPI document to contract/openapi.json.

The frontend generates its TypeScript types from that file, so it is committed and must match
the running API. Run from api/:

    uv run python scripts/export_openapi.py          # rewrite contract/openapi.json
    uv run python scripts/export_openapi.py --check  # exit 1 if the committed file is stale
"""

import argparse
import json
import sys
from pathlib import Path

API_DIR = Path(__file__).resolve().parents[1]
OUT = API_DIR.parent / "contract" / "openapi.json"

sys.path.insert(0, str(API_DIR))  # so "app" imports when run as scripts/export_openapi.py

from app.main import create_app  # noqa: E402


def render() -> str:
    return json.dumps(create_app().openapi(), indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true", help="fail instead of writing when the file is stale")
    args = parser.parse_args()

    spec = render()
    current = OUT.read_text(encoding="utf-8") if OUT.exists() else None
    if args.check:
        if current != spec:
            print(f"{OUT} is stale; run: uv run python scripts/export_openapi.py", file=sys.stderr)
            return 1
        print(f"{OUT} is up to date")
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(spec, encoding="utf-8")
    print(f"wrote {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
