"""Add planning units and mission planning metadata

Revision ID: 20260327_13
Revises: 20260327_12
Create Date: 2026-03-27 14:40:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_13"
down_revision = "20260327_12"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "planning_units",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=False),
        sa.Column("source_field_plot_id", sa.Integer(), nullable=False),
        sa.Column("parent_unit_id", sa.Integer(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("geometry_json", sa.Text(), nullable=False),
        sa.Column("area_m2", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_field_plot_id"], ["field_plots.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["parent_unit_id"], ["planning_units.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_planning_units_property_id", "planning_units", ["property_id"], unique=False)
    op.create_index("ix_planning_units_source_field_plot_id", "planning_units", ["source_field_plot_id"], unique=False)
    op.create_index("ix_planning_units_parent_unit_id", "planning_units", ["parent_unit_id"], unique=False)

    op.add_column(
        "flight_missions",
        sa.Column("planning_unit_ids_json", sa.Text(), nullable=False, server_default="[]"),
    )
    op.add_column(
        "flight_missions",
        sa.Column("drone_profile_id", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "flight_missions",
        sa.Column("drone_profile_snapshot_json", sa.Text(), nullable=False, server_default="{}"),
    )
    op.add_column(
        "flight_missions",
        sa.Column("estimated_duration_s", sa.Float(), nullable=True),
    )
    op.add_column(
        "flight_missions",
        sa.Column("duration_status", sa.String(length=24), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("flight_missions", "duration_status")
    op.drop_column("flight_missions", "estimated_duration_s")
    op.drop_column("flight_missions", "drone_profile_snapshot_json")
    op.drop_column("flight_missions", "drone_profile_id")
    op.drop_column("flight_missions", "planning_unit_ids_json")

    op.drop_index("ix_planning_units_parent_unit_id", table_name="planning_units")
    op.drop_index("ix_planning_units_source_field_plot_id", table_name="planning_units")
    op.drop_index("ix_planning_units_property_id", table_name="planning_units")
    op.drop_table("planning_units")
