"""Scope photo content hashes to one user.

Revision ID: 20260716_20
Revises: 20260716_19
Create Date: 2026-07-16 17:05:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260716_20"
down_revision = "20260716_19"
branch_labels = None
depends_on = None


_NAMING_CONVENTION = {"uq": "uq_%(table_name)s_%(column_0_N_name)s"}


def _assert_sqlite_foreign_keys_are_valid(connection, *, phase: str) -> None:
    if connection.dialect.name != "sqlite":
        return
    violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
    if violations:
        raise RuntimeError(f"Kan ikke {phase} bildehash-migreringen med ugyldige foreign keys")


def upgrade() -> None:
    connection = op.get_bind()
    _assert_sqlite_foreign_keys_are_valid(connection, phase="starte")

    op.drop_index("ix_photos_source_hash", table_name="photos")
    with op.batch_alter_table("photos", naming_convention=_NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("uq_photos_source_hash", type_="unique")
        batch_op.create_unique_constraint(
            "uq_photos_user_source_hash",
            ["user_id", "source_hash"],
        )
    op.create_index("ix_photos_source_hash", "photos", ["source_hash"], unique=False)

    _assert_sqlite_foreign_keys_are_valid(connection, phase="fullføre")


def downgrade() -> None:
    connection = op.get_bind()
    duplicate_hashes = connection.execute(
        sa.text(
            """
            SELECT source_hash
            FROM photos
            GROUP BY source_hash
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    if duplicate_hashes is not None:
        raise RuntimeError(
            "Bildehash-migreringen kan ikke nedgraderes etter at flere brukere har samme bildefil"
        )

    op.drop_index("ix_photos_source_hash", table_name="photos")
    with op.batch_alter_table("photos", naming_convention=_NAMING_CONVENTION) as batch_op:
        batch_op.drop_constraint("uq_photos_user_source_hash", type_="unique")
        batch_op.create_unique_constraint("uq_photos_source_hash", ["source_hash"])
    op.create_index("ix_photos_source_hash", "photos", ["source_hash"], unique=True)
