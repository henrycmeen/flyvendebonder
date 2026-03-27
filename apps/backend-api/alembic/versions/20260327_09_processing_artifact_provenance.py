"""Add provenance to processing artifacts

Revision ID: 20260327_09
Revises: 20260327_08
Create Date: 2026-03-27 10:28:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_09"
down_revision = "20260327_08"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "processing_artifacts",
        sa.Column("provenance_json", sa.Text(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("processing_artifacts", "provenance_json")
