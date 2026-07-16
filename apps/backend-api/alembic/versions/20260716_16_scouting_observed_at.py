"""Add explicit observation time to scouting tasks.

Revision ID: 20260716_16
Revises: 20260623_15
Create Date: 2026-07-16 11:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260716_16"
down_revision = "20260623_15"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("scouting_tasks", sa.Column("observed_at", sa.DateTime(), nullable=True))
    op.add_column(
        "scouting_tasks",
        sa.Column("observed_at_original_offset", sa.String(length=6), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scouting_tasks", "observed_at_original_offset")
    op.drop_column("scouting_tasks", "observed_at")
