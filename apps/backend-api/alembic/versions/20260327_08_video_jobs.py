"""Add video jobs and review persistence

Revision ID: 20260327_10
Revises: 20260327_09
Create Date: 2026-03-27 10:05:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260327_10"
down_revision = "20260327_09"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "video_jobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="SET NULL"), nullable=True),
        sa.Column("filename", sa.String(length=512), nullable=False),
        sa.Column("mode", sa.String(length=24), nullable=False, server_default="frames"),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="pending"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("config_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("result_frames_json", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )
    op.create_index("ix_video_jobs_user_id", "video_jobs", ["user_id"], unique=False)
    op.create_index("ix_video_jobs_property_id", "video_jobs", ["property_id"], unique=False)
    op.create_index("idx_video_jobs_user_created", "video_jobs", ["user_id", "created_at"], unique=False)

    op.create_table(
        "video_job_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("job_id", sa.String(length=64), sa.ForeignKey("video_jobs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("mode", sa.String(length=24), nullable=True),
        sa.Column("review_state", sa.String(length=24), nullable=False),
        sa.Column("placement_json", sa.Text(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("job_id", name="uq_video_job_review_job_id"),
    )
    op.create_index("ix_video_job_reviews_job_id", "video_job_reviews", ["job_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_video_job_reviews_job_id", table_name="video_job_reviews")
    op.drop_table("video_job_reviews")

    op.drop_index("idx_video_jobs_user_created", table_name="video_jobs")
    op.drop_index("ix_video_jobs_property_id", table_name="video_jobs")
    op.drop_index("ix_video_jobs_user_id", table_name="video_jobs")
    op.drop_table("video_jobs")
