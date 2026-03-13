"""Add field plots for manual field drafts

Revision ID: 20260313_06
Revises: 20260218_05
Create Date: 2026-03-13 12:00:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260313_06"
down_revision = "20260218_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "field_plots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="draft"),
        sa.Column("geometry_json", sa.Text(), nullable=False),
        sa.Column("area_m2", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_field_plots_property_id", "field_plots", ["property_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_field_plots_property_id", table_name="field_plots")
    op.drop_table("field_plots")
