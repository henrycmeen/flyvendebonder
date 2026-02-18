"""Add FVB-006 metadata coverage fields on photos

Revision ID: 20260218_05
Revises: 20260217_04
Create Date: 2026-02-18 18:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260218_05"
down_revision = "20260217_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("photos", sa.Column("gsd_m", sa.Float(), nullable=True))
    op.add_column("photos", sa.Column("image_footprint_w_m", sa.Float(), nullable=True))
    op.add_column("photos", sa.Column("track_spacing_m", sa.Float(), nullable=True))
    op.add_column("photos", sa.Column("overlap_front", sa.Float(), nullable=True))
    op.add_column("photos", sa.Column("overlap_side", sa.Float(), nullable=True))
    op.add_column("photos", sa.Column("oblique_correction_applied", sa.Boolean(), nullable=True))


def downgrade() -> None:
    op.drop_column("photos", "oblique_correction_applied")
    op.drop_column("photos", "overlap_side")
    op.drop_column("photos", "overlap_front")
    op.drop_column("photos", "track_spacing_m")
    op.drop_column("photos", "image_footprint_w_m")
    op.drop_column("photos", "gsd_m")
