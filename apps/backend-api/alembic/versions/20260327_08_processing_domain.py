"""Add flight capture and processing domain

Revision ID: 20260327_08
Revises: 20260313_07
Create Date: 2026-03-27 10:05:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_08"
down_revision = "20260313_07"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "flight_captures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("mission_id", sa.Integer(), sa.ForeignKey("flight_missions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="manual"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="ready"),
        sa.Column("photo_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("photo_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("field_ids_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("captured_from", sa.DateTime(), nullable=True),
        sa.Column("captured_to", sa.DateTime(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_flight_captures_user_id", "flight_captures", ["user_id"], unique=False)
    op.create_index("ix_flight_captures_property_id", "flight_captures", ["property_id"], unique=False)
    op.create_index("ix_flight_captures_mission_id", "flight_captures", ["mission_id"], unique=False)

    op.create_table(
        "processing_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("capture_id", sa.Integer(), sa.ForeignKey("flight_captures.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
        sa.Column("external_job_id", sa.String(length=255), nullable=True),
        sa.Column("requested_outputs_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("provider_config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("input_manifest_json", sa.Text(), nullable=False),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_processing_runs_capture_id", "processing_runs", ["capture_id"], unique=False)

    op.create_table(
        "processing_artifacts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "processing_run_id",
            sa.Integer(),
            sa.ForeignKey("processing_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("format", sa.String(length=32), nullable=False),
        sa.Column("uri", sa.String(length=1024), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=True),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("is_public", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        sa.Column("metadata_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_processing_artifacts_processing_run_id", "processing_artifacts", ["processing_run_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_processing_artifacts_processing_run_id", table_name="processing_artifacts")
    op.drop_table("processing_artifacts")
    op.drop_index("ix_processing_runs_capture_id", table_name="processing_runs")
    op.drop_table("processing_runs")
    op.drop_index("ix_flight_captures_mission_id", table_name="flight_captures")
    op.drop_index("ix_flight_captures_property_id", table_name="flight_captures")
    op.drop_index("ix_flight_captures_user_id", table_name="flight_captures")
    op.drop_table("flight_captures")
