"""Add photo analysis cache table

Revision ID: 20260217_03
Revises: 20260217_02
Create Date: 2026-02-17 17:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260217_03"
down_revision = "20260217_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "photo_analysis",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("photo_id", sa.String(length=128), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ar5_class", sa.String(length=255), nullable=True),
        sa.Column("soil_class", sa.String(length=255), nullable=True),
        sa.Column("geometry_method", sa.String(length=24), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("computed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("photo_id", name="uq_photo_analysis_photo_id"),
    )
    op.create_index("ix_photo_analysis_photo_id", "photo_analysis", ["photo_id"], unique=False)
    op.create_index("ix_photo_analysis_approved", "photo_analysis", ["approved"], unique=False)
    op.create_index("ix_photo_analysis_photo_approved", "photo_analysis", ["photo_id", "approved"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_photo_analysis_photo_approved", table_name="photo_analysis")
    op.drop_index("ix_photo_analysis_approved", table_name="photo_analysis")
    op.drop_index("ix_photo_analysis_photo_id", table_name="photo_analysis")
    op.drop_table("photo_analysis")
