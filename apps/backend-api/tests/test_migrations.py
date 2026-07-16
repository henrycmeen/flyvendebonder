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


def _migration_config(database_url: str) -> Config:
    cfg = Config(str(_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_ROOT / "alembic"))
    cfg.set_main_option("sqlalchemy.url", database_url)
    return cfg


def _insert_owner_before_farm_migration(connection, *, user_id: int, property_id: int) -> None:
    connection.execute(
        text(
            "INSERT INTO users (id, full_name, created_at, updated_at) "
            "VALUES (:user_id, :name, '2026-01-01', '2026-01-01')"
        ),
        {"user_id": user_id, "name": f"Eier {user_id}"},
    )
    connection.execute(
        text(
            "INSERT INTO properties ("
            "id, user_id, komm, gnr, bnr, fnr, operating_relation, created_at, updated_at"
            ") VALUES ("
            ":property_id, :user_id, '4003', :gnr, 1, 0, 'unknown', "
            "'2026-01-01', '2026-01-01'"
            ")"
        ),
        {"property_id": property_id, "user_id": user_id, "gnr": 70 + user_id},
    )


def _insert_ingest_run(connection, *, run_id: int) -> None:
    connection.execute(
        text(
            "INSERT INTO ingest_runs ("
            "id, started_at, source_path, files_seen, files_imported, files_skipped, errors_json"
            ") VALUES ("
            ":run_id, '2026-07-16', :source_path, 0, 0, 0, '[]'"
            ")"
        ),
        {"run_id": run_id, "source_path": f"/synthetic/run-{run_id}"},
    )


def _insert_photo(connection, *, photo_id: str, user_id: int, property_id: int, run_id: int) -> None:
    connection.execute(
        text(
            "INSERT INTO photos ("
            "id, user_id, property_id, ingest_run_id, captured_at, captured_date, lat, lng, "
            "source_filename, source_hash, tags_json, created_at, updated_at"
            ") VALUES ("
            ":photo_id, :user_id, :property_id, :run_id, '2026-07-16', '2026-07-16', "
            "59.0, 10.0, :filename, :source_hash, '[]', '2026-07-16', '2026-07-16'"
            ")"
        ),
        {
            "photo_id": photo_id,
            "user_id": user_id,
            "property_id": property_id,
            "run_id": run_id,
            "filename": f"{photo_id}.jpg",
            "source_hash": f"hash-{photo_id}",
        },
    )


def test_ingest_run_ownership_migration_backfills_and_downgrades(tmp_path, monkeypatch) -> None:
    from app.config import get_settings

    database_url = f"sqlite:///{(tmp_path / 'ingest-ownership.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    cfg = _migration_config(database_url)
    command.upgrade(cfg, "20260716_17")
    engine = create_engine(database_url)

    with engine.begin() as connection:
        _insert_owner_before_farm_migration(connection, user_id=1, property_id=1)
    command.upgrade(cfg, "20260716_18")
    with engine.begin() as connection:
        _insert_ingest_run(connection, run_id=1)
        _insert_ingest_run(connection, run_id=2)
        _insert_photo(connection, photo_id="photo-owned", user_id=1, property_id=1, run_id=1)

    command.upgrade(cfg, "20260716_19")
    with engine.connect() as connection:
        assert connection.execute(
            text("SELECT id, user_id FROM ingest_runs ORDER BY id")
        ).all() == [(1, 1), (2, 1)]
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        columns = {row.name: row for row in connection.execute(text("PRAGMA table_info(ingest_runs)"))}
        assert columns["user_id"].notnull == 1

    command.downgrade(cfg, "20260716_18")
    with engine.connect() as connection:
        assert connection.execute(text("SELECT COUNT(*) FROM ingest_runs")).scalar_one() == 2
        assert "user_id" not in {
            row.name for row in connection.execute(text("PRAGMA table_info(ingest_runs)"))
        }
        assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
    get_settings.cache_clear()


def test_ingest_run_ownership_migration_rejects_ambiguous_data_before_ddl(tmp_path, monkeypatch) -> None:
    from app.config import get_settings

    database_url = f"sqlite:///{(tmp_path / 'ambiguous-ingest-ownership.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    cfg = _migration_config(database_url)
    command.upgrade(cfg, "20260716_17")
    engine = create_engine(database_url)

    with engine.begin() as connection:
        _insert_owner_before_farm_migration(connection, user_id=1, property_id=1)
        _insert_owner_before_farm_migration(connection, user_id=2, property_id=2)
    command.upgrade(cfg, "20260716_18")
    with engine.begin() as connection:
        _insert_ingest_run(connection, run_id=1)
        _insert_photo(connection, photo_id="photo-user-1", user_id=1, property_id=1, run_id=1)
        _insert_photo(connection, photo_id="photo-user-2", user_id=2, property_id=2, run_id=1)

    for _attempt in range(2):
        try:
            command.upgrade(cfg, "20260716_19")
        except RuntimeError as exc:
            assert "flere brukeridentiteter" in str(exc)
        else:
            raise AssertionError("Tvetydig importkjøring skulle ha stoppet migreringen")

        with engine.connect() as connection:
            assert "user_id" not in {
                row.name for row in connection.execute(text("PRAGMA table_info(ingest_runs)"))
            }
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20260716_18"
    get_settings.cache_clear()
