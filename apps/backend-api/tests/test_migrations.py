from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory


_ROOT = Path(__file__).resolve().parents[1]
_VERSIONS_DIR = _ROOT / "alembic" / "versions"
_REVISION_RE = re.compile(r"revision\s*=\s*['\"]([^'\"]+)['\"]")


def _iter_revision_ids() -> Iterator[tuple[str, str]]:
    for path in sorted(_VERSIONS_DIR.glob("*.py")):
        if path.name == "__init__.py":
            continue
        content = path.read_text(encoding="utf-8")
        match = _REVISION_RE.search(content)
        assert match is not None, f"Migration missing revision: {path.name}"
        yield path.name, match.group(1)


def test_migration_revision_ids_are_unique() -> None:
    by_id: dict[str, list[str]] = {}
    for name, revision in _iter_revision_ids():
        by_id.setdefault(revision, []).append(name)

    duplicate_ids = {rev: files for rev, files in by_id.items() if len(files) > 1}
    assert not duplicate_ids, f"Dupliserte migrasjons-IDer funnet: {duplicate_ids}"


def test_migration_graph_has_single_head() -> None:
    cfg = Config(str(_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_ROOT / "alembic"))
    script = ScriptDirectory.from_config(cfg)

    heads = script.get_heads()
    assert len(heads) == 1, f"Forventet ett hovedhode, fant: {heads}"
