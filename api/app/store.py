"""Fixture-backed project store.

Projects are read from contract/fixtures/*.json at startup and validated against the
``Project`` model. A broken fixture fails startup (and therefore Render's /healthz check)
instead of failing later on one request.

If contract/prices.json exists (the Channel3 price cache, see app/prices.py), its entries are
laid over the fixture lines: price, retailer, product link, image and Channel3 id. Lines with no
cached price keep their fixture values, so the grid always has a number to show. A malformed
cache fails startup like a broken fixture; a cache entry for a line that no longer exists is
skipped with a warning (api/tests/test_fixtures.py catches that in CI).
"""

import json
import logging
import os
from pathlib import Path

from .models import MaterialLine, Project
from .prices import PriceCache, PriceEntry, prices_path

log = logging.getLogger("uvicorn.error")

# api/app/store.py -> parents[2] is the repo root.
DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "contract" / "fixtures"
DEFAULT_SAMPLES_PATH = Path(__file__).resolve().parents[2] / "contract" / "samples.json"
SAMPLE_ID_PREFIX = "mock-"  # matches MOCK_ID_PREFIX in lib/mock/ids.ts


def fixtures_dir() -> Path:
    return Path(os.environ.get("CONTRACT_FIXTURES_DIR", DEFAULT_FIXTURES_DIR))


def samples_path() -> Path | None:
    """contract/samples.json, or CONTRACT_SAMPLES_PATH; an empty value disables the samples."""
    raw = os.environ.get("CONTRACT_SAMPLES_PATH")
    if raw is None:
        return DEFAULT_SAMPLES_PATH
    return Path(raw) if raw else None


def load_samples(path: Path) -> list[Project]:
    """The SAMPLE projects (ids start "mock-"), validated like fixtures. Generated from the
    frontend catalog by scripts/export-samples.mjs."""
    projects = [Project.model_validate(item) for item in json.loads(path.read_text(encoding="utf-8"))]
    bad = [p.id for p in projects if not p.id.startswith(SAMPLE_ID_PREFIX)]
    if bad:
        raise ValueError(f"sample ids must start with {SAMPLE_ID_PREFIX!r}: {bad}")
    return projects


def load_projects(directory: Path) -> list[Project]:
    """The fixtures exactly as committed, with no price overlay."""
    files = sorted(directory.glob("*.json"))
    if not files:
        raise RuntimeError(f"no project fixtures found in {directory}")
    return [Project.model_validate_json(path.read_text(encoding="utf-8")) for path in files]


def _priced_line(line: MaterialLine, entry: PriceEntry) -> MaterialLine:
    # Re-validate rather than model_copy(update=...), which would skip the Price pattern check.
    return MaterialLine.model_validate(
        {
            # by_alias=False: ContractModel dumps camelCase by default, and the keys below are snake_case.
            **line.model_dump(by_alias=False),
            "channel3_product_id": entry.channel3_product_id,
            "price": entry.price,
            "retailer": entry.retailer,
            "product_url": entry.url,
            "image_url": entry.image_url,
        }
    )


def apply_prices(projects: list[Project], cache: PriceCache) -> list[Project]:
    """Overlay cached Channel3 prices onto fixture lines. The line name, qty and alternatives stay."""
    known = {p.id: {line.id for line in p.materials} for p in projects}
    for project_id, lines in cache.projects.items():
        stale = set(lines) - known.get(project_id, set())
        if stale:
            log.warning("prices.json has entries for unknown lines in %s: %s", project_id, sorted(stale))

    priced = []
    for project in projects:
        materials = []
        for line in project.materials:
            entry = cache.entry(project.id, line.id)
            if entry is not None and entry.currency != project.currency:
                log.warning("prices.json %s/%s is in %s, project is %s; keeping fixture price",
                            project.id, line.id, entry.currency, project.currency)
                entry = None
            materials.append(line if entry is None else _priced_line(line, entry))
        priced.append(project.model_copy(update={"materials": materials}))
    return priced


class FixtureStore:
    def __init__(self, projects: list[Project], samples: list[Project] | None = None) -> None:
        self._by_slug: dict[str, Project] = {}
        self._by_id: dict[str, Project] = {}
        self._samples: dict[str, Project] = {}
        for project in [*projects, *(samples or [])]:
            if project.slug in self._by_slug or project.id in self._by_id:
                raise ValueError(f"duplicate project id or slug in fixtures: {project.id} / {project.slug}")
            line_ids = [line.id for line in project.materials]
            if len(set(line_ids)) != len(line_ids):
                raise ValueError(f"duplicate material line id in project {project.id}")
            mixed = {line.currency for line in project.materials} - {project.currency}
            if mixed:
                raise ValueError(f"project {project.id} has lines in {sorted(mixed)}, expected {project.currency}")
            self._by_slug[project.slug] = project
            self._by_id[project.id] = project
        for sample in samples or []:
            self._samples[sample.id] = sample

    @classmethod
    def from_dir(cls, directory: Path) -> "FixtureStore":
        """Fixtures plus the price cache at prices_path() (CONTRACT_PRICES_PATH="" disables it)."""
        projects = load_projects(directory)
        cache_file = prices_path()
        if cache_file is not None and cache_file.exists():
            projects = apply_prices(projects, PriceCache.load(cache_file))
        sample_file = samples_path()
        # Samples keep their placeholder prices: the Channel3 overlay is for real projects only.
        samples = load_samples(sample_file) if sample_file is not None and sample_file.exists() else []
        return cls(projects, samples)

    def projects(self) -> list[Project]:
        """The real projects. Samples are priced by id but not listed; the site adds its own."""
        return [p for p in self._by_slug.values() if p.id not in self._samples]

    def by_slug(self, slug: str) -> Project | None:
        project = self._by_slug.get(slug)
        return None if project is not None and project.id in self._samples else project

    def by_id(self, project_id: str) -> Project | None:
        return self._by_id.get(project_id)

    def is_sample(self, project_id: str) -> bool:
        return project_id in self._samples
