"""Add camera pitch column on photos

Revision ID: 20260217_04
Revises: 20260217_03
Create Date: 2026-02-17 18:15:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260217_04"
down_revision = "20260217_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("photos", sa.Column("pitch_deg", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("photos", "pitch_deg")
