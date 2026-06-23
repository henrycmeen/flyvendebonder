"""Add scouting tasks for field observations

Revision ID: 20260623_15
Revises: 20260621_14
Create Date: 2026-06-23 08:20:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260623_15"
down_revision = "20260621_14"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scouting_tasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("field_plot_id", sa.Integer(), nullable=False),
        sa.Column("planning_unit_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="open"),
        sa.Column("priority", sa.String(length=24), nullable=False, server_default="normal"),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("photo_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["field_plot_id"], ["field_plots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["planning_unit_id"], ["planning_units.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scouting_tasks_property_id", "scouting_tasks", ["property_id"], unique=False)
    op.create_index("ix_scouting_tasks_field_plot_id", "scouting_tasks", ["field_plot_id"], unique=False)
    op.create_index("ix_scouting_tasks_planning_unit_id", "scouting_tasks", ["planning_unit_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_scouting_tasks_planning_unit_id", table_name="scouting_tasks")
    op.drop_index("ix_scouting_tasks_field_plot_id", table_name="scouting_tasks")
    op.drop_index("ix_scouting_tasks_property_id", table_name="scouting_tasks")
    op.drop_table("scouting_tasks")
