"""Add flight missions for field-based route planning

Revision ID: 20260313_07
Revises: 20260313_06
Create Date: 2026-03-13 22:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260313_07"
down_revision = "20260313_06"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flight_missions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ready"),
        sa.Column("field_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("parameters_json", sa.Text(), nullable=False),
        sa.Column("field_snapshots_json", sa.Text(), nullable=False),
        sa.Column("route_geojson_json", sa.Text(), nullable=False),
        sa.Column("warnings_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("export_manifest_json", sa.Text(), nullable=False),
        sa.Column("last_generated_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_flight_missions_property_id", "flight_missions", ["property_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_flight_missions_property_id", table_name="flight_missions")
    op.drop_table("flight_missions")
