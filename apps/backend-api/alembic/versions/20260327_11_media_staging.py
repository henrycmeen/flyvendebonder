"""Add media staging jobs and items

Revision ID: 20260327_11
Revises: 20260327_10
Create Date: 2026-03-27 11:55:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_11"
down_revision = "20260327_10"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_staging_jobs",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("property_id", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(length=24), nullable=False, server_default="upload"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="staged"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["property_id"], ["properties.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_media_staging_jobs_user_id", "media_staging_jobs", ["user_id"])
    op.create_index("ix_media_staging_jobs_property_id", "media_staging_jobs", ["property_id"])
    op.create_index(
        "idx_media_staging_jobs_user_created",
        "media_staging_jobs",
        ["user_id", "created_at"],
    )

    op.create_table(
        "media_staging_items",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("job_id", sa.String(length=64), nullable=False),
        sa.Column("item_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("mime", sa.String(length=255), nullable=True),
        sa.Column("bytes", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("checksum", sa.String(length=128), nullable=True),
        sa.Column("media_kind", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="staged"),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("staged_path", sa.String(length=1024), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["media_staging_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_id", "item_order", name="uq_media_staging_items_order"),
    )
    op.create_index("ix_media_staging_items_job_id", "media_staging_items", ["job_id"])


def downgrade() -> None:
    op.drop_index("ix_media_staging_items_job_id", table_name="media_staging_items")
    op.drop_table("media_staging_items")
    op.drop_index("idx_media_staging_jobs_user_created", table_name="media_staging_jobs")
    op.drop_index("ix_media_staging_jobs_property_id", table_name="media_staging_jobs")
    op.drop_index("ix_media_staging_jobs_user_id", table_name="media_staging_jobs")
    op.drop_table("media_staging_jobs")
