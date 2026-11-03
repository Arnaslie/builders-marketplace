"""Flagship fixtures (#17): complete, valid, and fully covered by Channel3 search phrases."""

import json
from pathlib import Path

import pytest

from app.models import Project

CONTRACT = Path(__file__).resolve().parents[2] / "contract"
FIXTURES = sorted((CONTRACT / "fixtures").glob("*.json"))


def _load(path: Path) -> Project:
    return Project.model_validate(json.loads(path.read_text()))


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_flagship_is_complete(path: Path) -> None:
    project = _load(path)
    assert "STUB" not in project.summary
    assert len(project.steps) >= 5
    assert len(project.materials) >= 10
    assert {m.category for m in project.materials} == {"material", "tool"}
    assert len({m.id for m in project.materials}) == len(project.materials)


def test_every_line_has_a_channel3_query() -> None:
    queries = json.loads((CONTRACT / "channel3-queries.json").read_text())
    queries.pop("_about")
    line_ids = {m.id for path in FIXTURES for m in _load(path).materials}
    assert set(queries) == line_ids
    assert all(q.strip() for q in queries.values())
