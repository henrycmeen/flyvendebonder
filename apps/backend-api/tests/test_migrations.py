from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, text


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


def test_observed_at_migration_keeps_existing_scouting_tasks_unknown(tmp_path, monkeypatch) -> None:
    from app.config import get_settings

    database_url = f"sqlite:///{(tmp_path / 'migration.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    cfg = Config(str(_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_ROOT / "alembic"))
    command.upgrade(cfg, "20260623_15")

    engine = create_engine(database_url)
    with engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO users (id, full_name, created_at, updated_at) "
                "VALUES (1, 'Eldre bruker', '2026-01-01', '2026-01-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO properties (id, user_id, komm, gnr, bnr, fnr, created_at, updated_at) "
                "VALUES (1, 1, '4003', 70, 17, 0, '2026-01-01', '2026-01-01')"
            )
        )
        connection.execute(
            text(
                "INSERT INTO field_plots ("
                "id, property_id, source, status, geometry_json, source_provenance_json, created_at, updated_at"
                ") VALUES ("
                "1, 1, 'manual', 'draft', '{\"type\":\"Polygon\",\"coordinates\":[]}', '{}', "
                "'2026-01-01', '2026-01-01')"
            )
        )
        connection.execute(
            text(
                """
                INSERT INTO scouting_tasks (
                    property_id, field_plot_id, planning_unit_id, title, notes,
                    status, priority, lat, lng, photo_ids_json, created_at, updated_at
                ) VALUES (
                    1, 1, NULL, 'Eldre funn', NULL,
                    'open', 'normal', 59.0, 10.0, '[]',
                    '2026-07-15 12:00:00', '2026-07-15 12:00:00'
                )
                """
            )
        )

    command.upgrade(cfg, "head")

    with engine.connect() as connection:
        row = connection.execute(
            text(
                "SELECT observed_at, observed_at_original_offset "
                "FROM scouting_tasks WHERE title = 'Eldre funn'"
            )
        ).one()
        property_row = connection.execute(
            text(
                "SELECT operating_relation, operating_relation_source, "
                "operating_relation_confirmed_at FROM properties WHERE id = 1"
            )
        ).one()
        field_source_key = connection.execute(
            text("SELECT source_key FROM field_plots WHERE id = 1")
        ).scalar_one()

    assert row.observed_at is None
    assert row.observed_at_original_offset is None
    assert property_row.operating_relation == "unknown"
    assert property_row.operating_relation_source is None
    assert property_row.operating_relation_confirmed_at is None
    assert field_source_key is None
    get_settings.cache_clear()
