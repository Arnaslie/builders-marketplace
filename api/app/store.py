"""Fixture-backed project store.

Projects are read from contract/fixtures/*.json at startup and validated against the
``Project`` model. A broken fixture fails startup (and therefore Render's /healthz check)
instead of failing later on one request.
"""

import os
from pathlib import Path

from .models import Project

# api/app/store.py -> parents[2] is the repo root.
DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parents[2] / "contract" / "fixtures"


def fixtures_dir() -> Path:
    return Path(os.environ.get("CONTRACT_FIXTURES_DIR", DEFAULT_FIXTURES_DIR))


class FixtureStore:
    def __init__(self, projects: list[Project]) -> None:
        self._by_slug: dict[str, Project] = {}
        self._by_id: dict[str, Project] = {}
        for project in projects:
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

    @classmethod
    def from_dir(cls, directory: Path) -> "FixtureStore":
        files = sorted(directory.glob("*.json"))
        if not files:
            raise RuntimeError(f"no project fixtures found in {directory}")
        return cls([Project.model_validate_json(path.read_text(encoding="utf-8")) for path in files])

    def projects(self) -> list[Project]:
        return list(self._by_slug.values())

    def by_slug(self, slug: str) -> Project | None:
        return self._by_slug.get(slug)

    def by_id(self, project_id: str) -> Project | None:
        return self._by_id.get(project_id)
