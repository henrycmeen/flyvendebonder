"""Add composite index for photos page endpoint

Revision ID: 20260217_02
Revises: 20260217_01
Create Date: 2026-02-17 15:10:00
"""

from __future__ import annotations

from alembic import op


revision = "20260217_02"
down_revision = "20260217_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "idx_photos_user_captured_at_id",
        "photos",
        ["user_id", "captured_at", "id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_photos_user_captured_at_id", table_name="photos")
