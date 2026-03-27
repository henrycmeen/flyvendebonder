"""Add provenance spine fields for raw photos and processing artifacts

Revision ID: 20260327_11
Revises: 20260327_10
Create Date: 2026-03-27 11:35:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_11"
down_revision = "20260327_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("photos") as batch_op:
        batch_op.add_column(sa.Column("ingest_run_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("source_ref", sa.String(length=2048), nullable=True))
        batch_op.create_index("ix_photos_ingest_run_id", ["ingest_run_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_photos_ingest_run_id",
            "ingest_runs",
            ["ingest_run_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("photo_assets") as batch_op:
        batch_op.add_column(sa.Column("ingest_run_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("checksum", sa.String(length=128), nullable=True))
        batch_op.add_column(sa.Column("source_ref", sa.String(length=2048), nullable=True))
        batch_op.add_column(sa.Column("provenance_json", sa.Text(), nullable=False, server_default="{}"))
        batch_op.create_index("ix_photo_assets_ingest_run_id", ["ingest_run_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_photo_assets_ingest_run_id",
            "ingest_runs",
            ["ingest_run_id"],
            ["id"],
            ondelete="SET NULL",
        )

    with op.batch_alter_table("processing_artifacts") as batch_op:
        batch_op.add_column(sa.Column("ingest_run_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("source_ref", sa.String(length=2048), nullable=True))
        batch_op.create_index("ix_processing_artifacts_ingest_run_id", ["ingest_run_id"], unique=False)
        batch_op.create_foreign_key(
            "fk_processing_artifacts_ingest_run_id",
            "ingest_runs",
            ["ingest_run_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("processing_artifacts") as batch_op:
        batch_op.drop_constraint("fk_processing_artifacts_ingest_run_id", type_="foreignkey")
        batch_op.drop_index("ix_processing_artifacts_ingest_run_id")
        batch_op.drop_column("source_ref")
        batch_op.drop_column("ingest_run_id")

    with op.batch_alter_table("photo_assets") as batch_op:
        batch_op.drop_constraint("fk_photo_assets_ingest_run_id", type_="foreignkey")
        batch_op.drop_index("ix_photo_assets_ingest_run_id")
        batch_op.drop_column("provenance_json")
        batch_op.drop_column("source_ref")
        batch_op.drop_column("checksum")
        batch_op.drop_column("ingest_run_id")

    with op.batch_alter_table("photos") as batch_op:
        batch_op.drop_constraint("fk_photos_ingest_run_id", type_="foreignkey")
        batch_op.drop_index("ix_photos_ingest_run_id")
        batch_op.drop_column("source_ref")
        batch_op.drop_column("ingest_run_id")
