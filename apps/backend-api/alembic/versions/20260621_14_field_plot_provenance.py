"""Add source provenance to field plots

Revision ID: 20260621_14
Revises: 20260327_13
Create Date: 2026-06-21 09:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260621_14"
down_revision = "20260327_13"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "field_plots",
        sa.Column("source_provenance_json", sa.Text(), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    op.drop_column("field_plots", "source_provenance_json")
