"""Add farms and farm memberships with owner bootstrap.

Revision ID: 20260716_18
Revises: 20260716_17
Create Date: 2026-07-16 15:10:00
"""

from __future__ import annotations

from datetime import datetime

from alembic import op
import sqlalchemy as sa


revision = "20260716_18"
down_revision = "20260716_17"
branch_labels = None
depends_on = None


ROLE_CHECK = "role IN ('owner', 'operator', 'advisor', 'viewer')"
STATUS_CHECK = "status IN ('invited', 'active', 'revoked', 'expired')"


def _assert_sqlite_foreign_keys_are_valid(connection, *, phase: str) -> None:
    if connection.dialect.name != "sqlite":
        return
    foreign_key_violations = connection.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
    if foreign_key_violations:
        raise RuntimeError(
            f"Kan ikke {phase} medlemskapsmigreringen med ugyldige foreign keys"
        )


def upgrade() -> None:
    connection = op.get_bind()
    # SQLite DDL is not transactional. Reject historical orphan rows before
    # creating anything so a failed preflight remains safe to retry.
    _assert_sqlite_foreign_keys_are_valid(connection, phase="starte")

    op.create_table(
        "farms",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "farm_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("farm_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(ROLE_CHECK, name="ck_farm_membership_role"),
        sa.CheckConstraint(STATUS_CHECK, name="ck_farm_membership_status"),
        sa.ForeignKeyConstraint(["farm_id"], ["farms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("farm_id", "user_id", name="uq_farm_membership_user"),
    )
    op.create_index("ix_farm_memberships_farm_id", "farm_memberships", ["farm_id"], unique=False)
    op.create_index("ix_farm_memberships_user_id", "farm_memberships", ["user_id"], unique=False)

    op.add_column("properties", sa.Column("farm_id", sa.Integer(), nullable=True))

    owners = connection.execute(
        sa.text(
            """
            SELECT users.id AS user_id, users.full_name AS full_name,
                   MIN(properties.label) AS property_label
            FROM users
            JOIN properties ON properties.user_id = users.id
            GROUP BY users.id, users.full_name
            ORDER BY users.id
            """
        )
    ).mappings()
    now = datetime.utcnow()

    for owner in owners:
        property_label = (owner["property_label"] or "").strip()
        full_name = (owner["full_name"] or "").strip()
        farm_name = property_label or (f"{full_name} gård" if full_name else "Gård")
        result = connection.execute(
            sa.text(
                "INSERT INTO farms (name, created_at, updated_at) "
                "VALUES (:name, :created_at, :updated_at)"
            ),
            {"name": farm_name, "created_at": now, "updated_at": now},
        )
        farm_id = result.lastrowid
        if farm_id is None:
            raise RuntimeError("Kunne ikke opprette gård under medlemskapsmigrering")

        connection.execute(
            sa.text(
                """
                INSERT INTO farm_memberships
                    (farm_id, user_id, role, status, created_at, updated_at)
                VALUES
                    (:farm_id, :user_id, 'owner', 'active', :created_at, :updated_at)
                """
            ),
            {
                "farm_id": farm_id,
                "user_id": owner["user_id"],
                "created_at": now,
                "updated_at": now,
            },
        )
        connection.execute(
            sa.text("UPDATE properties SET farm_id = :farm_id WHERE user_id = :user_id"),
            {"farm_id": farm_id, "user_id": owner["user_id"]},
        )

    missing_farm_count = connection.execute(
        sa.text("SELECT COUNT(*) FROM properties WHERE farm_id IS NULL")
    ).scalar_one()
    if missing_farm_count:
        raise RuntimeError("Alle eksisterende eiendommer må få en gård før migreringen fortsetter")

    with op.batch_alter_table("properties") as batch_op:
        batch_op.alter_column("farm_id", existing_type=sa.Integer(), nullable=False)
        batch_op.create_foreign_key(
            "fk_properties_farm_id_farms",
            "farms",
            ["farm_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_unique_constraint(
            "uq_property_farm",
            ["farm_id", "komm", "gnr", "bnr", "fnr"],
        )
    op.create_index("ix_properties_farm_id", "properties", ["farm_id"], unique=False)

    _assert_sqlite_foreign_keys_are_valid(connection, phase="fullføre")


def downgrade() -> None:
    op.drop_index("ix_properties_farm_id", table_name="properties")
    with op.batch_alter_table("properties") as batch_op:
        batch_op.drop_constraint("uq_property_farm", type_="unique")
        batch_op.drop_constraint("fk_properties_farm_id_farms", type_="foreignkey")
        batch_op.drop_column("farm_id")

    op.drop_index("ix_farm_memberships_user_id", table_name="farm_memberships")
    op.drop_index("ix_farm_memberships_farm_id", table_name="farm_memberships")
    op.drop_table("farm_memberships")
    op.drop_table("farms")
