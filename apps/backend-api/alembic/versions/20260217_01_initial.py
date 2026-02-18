"""Initial schema

Revision ID: 20260217_01
Revises:
Create Date: 2026-02-17 12:30:00
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260217_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("phone", sa.String(length=64), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("address_line1", sa.String(length=255), nullable=True),
        sa.Column("postal_code", sa.String(length=16), nullable=True),
        sa.Column("city", sa.String(length=120), nullable=True),
        sa.Column("municipality_code", sa.String(length=8), nullable=True),
        sa.Column("municipality_name", sa.String(length=120), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )

    op.create_table(
        "properties",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("komm", sa.String(length=8), nullable=False),
        sa.Column("gnr", sa.Integer(), nullable=False),
        sa.Column("bnr", sa.Integer(), nullable=False),
        sa.Column("fnr", sa.Integer(), nullable=False),
        sa.Column("label", sa.String(length=255), nullable=True),
        sa.Column("active_from", sa.Date(), nullable=True),
        sa.Column("active_to", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("user_id", "komm", "gnr", "bnr", "fnr", name="uq_property_owner"),
    )
    op.create_index("ix_properties_user_id", "properties", ["user_id"], unique=False)

    op.create_table(
        "photos",
        sa.Column("id", sa.String(length=128), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="SET NULL"), nullable=True),
        sa.Column("captured_at", sa.DateTime(), nullable=False),
        sa.Column("captured_date", sa.Date(), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("altitude_m", sa.Float(), nullable=True),
        sa.Column("heading_deg", sa.Float(), nullable=True),
        sa.Column("source_filename", sa.String(length=512), nullable=False),
        sa.Column("source_hash", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("tags_json", sa.Text(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("source_hash"),
    )
    op.create_index("ix_photos_user_id", "photos", ["user_id"], unique=False)
    op.create_index("ix_photos_property_id", "photos", ["property_id"], unique=False)
    op.create_index("ix_photos_captured_at", "photos", ["captured_at"], unique=False)
    op.create_index("ix_photos_captured_date", "photos", ["captured_date"], unique=False)
    op.create_index("ix_photos_source_hash", "photos", ["source_hash"], unique=True)
    op.create_index(
        "idx_photo_secondary_dedupe",
        "photos",
        ["source_filename", "captured_at", "lat", "lng"],
        unique=False,
    )

    op.create_table(
        "photo_assets",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("photo_id", sa.String(length=128), sa.ForeignKey("photos.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=32), nullable=False),
        sa.Column("path", sa.String(length=1024), nullable=False),
        sa.Column("mime", sa.String(length=128), nullable=False),
        sa.Column("bytes", sa.Integer(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.UniqueConstraint("photo_id", "kind", name="uq_photo_asset_kind"),
    )
    op.create_index("ix_photo_assets_photo_id", "photo_assets", ["photo_id"], unique=False)

    op.create_table(
        "gardskart_job_cache",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("property_id", sa.Integer(), sa.ForeignKey("properties.id", ondelete="CASCADE"), nullable=False),
        sa.Column("job_id", sa.String(length=128), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("status_desc", sa.Text(), nullable=True),
        sa.Column("fetched_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("last_validated_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_gardskart_job_cache_property_id", "gardskart_job_cache", ["property_id"], unique=False)

    op.create_table(
        "ingest_runs",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("started_at", sa.DateTime(), nullable=False),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("source_path", sa.String(length=2048), nullable=False),
        sa.Column("files_seen", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_imported", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("files_skipped", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("errors_json", sa.Text(), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_table("ingest_runs")
    op.drop_index("ix_gardskart_job_cache_property_id", table_name="gardskart_job_cache")
    op.drop_table("gardskart_job_cache")
    op.drop_index("ix_photo_assets_photo_id", table_name="photo_assets")
    op.drop_table("photo_assets")
    op.drop_index("idx_photo_secondary_dedupe", table_name="photos")
    op.drop_index("ix_photos_source_hash", table_name="photos")
    op.drop_index("ix_photos_captured_date", table_name="photos")
    op.drop_index("ix_photos_captured_at", table_name="photos")
    op.drop_index("ix_photos_property_id", table_name="photos")
    op.drop_index("ix_photos_user_id", table_name="photos")
    op.drop_table("photos")
    op.drop_index("ix_properties_user_id", table_name="properties")
    op.drop_table("properties")
    op.drop_table("users")
