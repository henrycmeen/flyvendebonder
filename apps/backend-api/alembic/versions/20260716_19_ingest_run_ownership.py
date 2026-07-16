"""Bind ingest runs to one user.

Revision ID: 20260716_19
Revises: 20260716_18
Create Date: 2026-07-16 17:10:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260716_19"
down_revision = "20260716_18"
branch_labels = None
depends_on = None


def _assert_sqlite_foreign_keys_are_valid(connection, *, phase: str) -> None:
    if connection.dialect.name != "sqlite":
        return
    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise RuntimeError(f"Kan ikke {phase} import-eierskapsmigreringen med ugyldige foreign keys")


def _candidate_users_by_run(connection) -> dict[int, set[int]]:
    rows = connection.execute(
        sa.text(
            """
            SELECT ingest_run_id, user_id
            FROM photos
            WHERE ingest_run_id IS NOT NULL
            UNION
            SELECT photo_assets.ingest_run_id, photos.user_id
            FROM photo_assets
            JOIN photos
              ON photos.id = photo_assets.photo_id
            WHERE photo_assets.ingest_run_id IS NOT NULL
            UNION
            SELECT processing_artifacts.ingest_run_id, flight_captures.user_id
            FROM processing_artifacts
            JOIN processing_runs
              ON processing_runs.id = processing_artifacts.processing_run_id
            JOIN flight_captures
              ON flight_captures.id = processing_runs.capture_id
            WHERE processing_artifacts.ingest_run_id IS NOT NULL
            """
        )
    )
    candidates: dict[int, set[int]] = {}
    for run_id, user_id in rows:
        candidates.setdefault(int(run_id), set()).add(int(user_id))
    return candidates


def upgrade() -> None:
    connection = op.get_bind()
    _assert_sqlite_foreign_keys_are_valid(connection, phase="starte")

    run_ids = [int(row[0]) for row in connection.execute(sa.text("SELECT id FROM ingest_runs"))]
    candidates = _candidate_users_by_run(connection)
    ambiguous = sorted(run_id for run_id, user_ids in candidates.items() if len(user_ids) != 1)
    if ambiguous:
        raise RuntimeError("Importkjøringer med flere brukeridentiteter kan ikke migreres automatisk")

    fallback_owner_ids = [
        int(row[0])
        for row in connection.execute(
            sa.text(
                """
                SELECT DISTINCT user_id
                FROM farm_memberships
                WHERE role = 'owner' AND status = 'active'
                ORDER BY user_id
                """
            )
        )
    ]
    unresolved = [run_id for run_id in run_ids if run_id not in candidates]
    if unresolved and len(fallback_owner_ids) != 1:
        raise RuntimeError(
            "Eierløse importkjøringer krever nøyaktig én aktiv eier før migrering"
        )

    op.add_column("ingest_runs", sa.Column("user_id", sa.Integer(), nullable=True))
    fallback_user_id = fallback_owner_ids[0] if fallback_owner_ids else None
    for run_id in run_ids:
        user_id = next(iter(candidates[run_id])) if run_id in candidates else fallback_user_id
        connection.execute(
            sa.text("UPDATE ingest_runs SET user_id = :user_id WHERE id = :run_id"),
            {"user_id": user_id, "run_id": run_id},
        )

    with op.batch_alter_table("ingest_runs") as batch_op:
        batch_op.alter_column("user_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            "fk_ingest_runs_user_id_users",
            "users",
            ["user_id"],
            ["id"],
            ondelete="CASCADE",
        )
    op.create_index("ix_ingest_runs_user_id", "ingest_runs", ["user_id"], unique=False)

    _assert_sqlite_foreign_keys_are_valid(connection, phase="fullføre")


def downgrade() -> None:
    op.drop_index("ix_ingest_runs_user_id", table_name="ingest_runs")
    with op.batch_alter_table("ingest_runs") as batch_op:
        batch_op.drop_constraint("fk_ingest_runs_user_id_users", type_="foreignkey")
        batch_op.drop_column("user_id")
