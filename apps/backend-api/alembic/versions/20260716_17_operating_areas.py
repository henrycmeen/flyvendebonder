"""Add explicit operating-area relation and stable imported field keys.

Revision ID: 20260716_17
Revises: 20260716_16
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260716_17"
down_revision = "20260716_16"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "properties",
        sa.Column("operating_relation", sa.String(length=16), nullable=False, server_default="unknown"),
    )
    op.add_column("properties", sa.Column("operating_relation_source", sa.String(length=32), nullable=True))
    op.add_column("properties", sa.Column("operating_relation_confirmed_at", sa.DateTime(), nullable=True))
    op.add_column("field_plots", sa.Column("source_key", sa.String(length=64), nullable=True))
    with op.batch_alter_table("field_plots") as batch_op:
        batch_op.create_unique_constraint(
            "uq_field_plot_source_key", ["property_id", "source", "source_key"]
        )


def downgrade() -> None:
    with op.batch_alter_table("field_plots") as batch_op:
        batch_op.drop_constraint("uq_field_plot_source_key", type_="unique")
    op.drop_column("field_plots", "source_key")
    op.drop_column("properties", "operating_relation_confirmed_at")
    op.drop_column("properties", "operating_relation_source")
    op.drop_column("properties", "operating_relation")
