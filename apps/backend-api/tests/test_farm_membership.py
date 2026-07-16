from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy.exc import IntegrityError


PREVIOUS_REVISION = "20260716_17"


def _alembic_config(database_url: str) -> Config:
    backend_dir = Path(__file__).resolve().parents[1]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "alembic"))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_membership_migration_backfills_one_farm_per_existing_owner(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "legacy-memberships.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        _assert_membership_migration(database_path, database_url)
    finally:
        # Alembic imports the cached application settings in env.py. Avoid
        # leaking this test database into fixtures that run afterwards.
        get_settings.cache_clear()


def _assert_membership_migration(database_path: Path, database_url: str) -> None:
    config = _alembic_config(database_url)
    command.upgrade(config, PREVIOUS_REVISION)

    now = datetime(2026, 7, 16, 12, 0, 0).isoformat(sep=" ")
    with sqlite3.connect(database_path) as connection:
        connection.executemany(
            "INSERT INTO users (id, full_name, created_at, updated_at) VALUES (?, ?, ?, ?)",
            [
                (1, "Første bonde", now, now),
                (2, "Andre bonde", now, now),
            ],
        )
        connection.executemany(
            """
            INSERT INTO properties
                (id, user_id, komm, gnr, bnr, fnr, label, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (1, 1, "4003", 70, 27, 0, "Hovedgård", now, now),
                (2, 1, "4003", 70, 28, 0, "Leid eiendom", now, now),
                (3, 2, "3901", 12, 3, 0, "Annen gård", now, now),
            ],
        )
        connection.execute(
            """
            INSERT INTO field_plots
                (id, property_id, source, status, geometry_json,
                 source_provenance_json, created_at, updated_at)
            VALUES
                (1, 1, 'manual', 'draft',
                 '{"type":"Polygon","coordinates":[]}', '{}', ?, ?)
            """,
            (now, now),
        )
        connection.commit()

    command.upgrade(config, "head")
    # A repeated upgrade must not create duplicate farms or memberships.
    command.upgrade(config, "head")

    with sqlite3.connect(database_path) as connection:
        farms = connection.execute("SELECT id, name FROM farms ORDER BY id").fetchall()
        memberships = connection.execute(
            "SELECT farm_id, user_id, role, status FROM farm_memberships ORDER BY user_id"
        ).fetchall()
        properties = connection.execute(
            "SELECT id, user_id, farm_id FROM properties ORDER BY id"
        ).fetchall()
        foreign_key_violations = connection.execute("PRAGMA foreign_key_check").fetchall()
        retained_field_plot = connection.execute(
            "SELECT id, property_id FROM field_plots WHERE id = 1"
        ).fetchone()

    assert len(farms) == 2
    assert memberships == [
        (farms[0][0], 1, "owner", "active"),
        (farms[1][0], 2, "owner", "active"),
    ]
    assert properties[0][2] == properties[1][2] == farms[0][0]
    assert properties[2][2] == farms[1][0]
    assert all(farm_id is not None for _, _, farm_id in properties)
    assert foreign_key_violations == []
    assert retained_field_plot == (1, 1)

    command.downgrade(config, PREVIOUS_REVISION)
    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
        property_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(properties)").fetchall()
        }
        retained_properties = connection.execute(
            "SELECT id, user_id, komm, gnr, bnr, fnr FROM properties ORDER BY id"
        ).fetchall()
        retained_field_plot = connection.execute(
            "SELECT id, property_id FROM field_plots WHERE id = 1"
        ).fetchone()

    assert "farms" not in tables
    assert "farm_memberships" not in tables
    assert "farm_id" not in property_columns
    assert retained_properties == [
        (1, 1, "4003", 70, 27, 0),
        (2, 1, "4003", 70, 28, 0),
        (3, 2, "3901", 12, 3, 0),
    ]
    assert retained_field_plot == (1, 1)


def test_membership_migration_rejects_historical_orphan_before_schema_changes(
    tmp_path, monkeypatch
) -> None:
    database_path = tmp_path / "orphaned-memberships.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    from app.config import get_settings

    get_settings.cache_clear()
    try:
        config = _alembic_config(database_url)
        command.upgrade(config, PREVIOUS_REVISION)
        now = datetime(2026, 7, 16, 12, 0, 0).isoformat(sep=" ")
        with sqlite3.connect(database_path) as connection:
            connection.execute(
                """
                INSERT INTO field_plots
                    (id, property_id, source, status, geometry_json,
                     source_provenance_json, created_at, updated_at)
                VALUES
                    (1, 999999, 'manual', 'draft',
                     '{"type":"Polygon","coordinates":[]}', '{}', ?, ?)
                """,
                (now, now),
            )
            connection.commit()

        for _attempt in range(2):
            with pytest.raises(RuntimeError, match="starte medlemskapsmigreringen"):
                command.upgrade(config, "head")

            with sqlite3.connect(database_path) as connection:
                tables = {
                    row[0]
                    for row in connection.execute(
                        "SELECT name FROM sqlite_master WHERE type = 'table'"
                    ).fetchall()
                }
                property_columns = {
                    row[1]
                    for row in connection.execute("PRAGMA table_info(properties)").fetchall()
                }
                version = connection.execute(
                    "SELECT version_num FROM alembic_version"
                ).fetchone()

            assert "farms" not in tables
            assert "farm_memberships" not in tables
            assert "farm_id" not in property_columns
            assert version == (PREVIOUS_REVISION,)
    finally:
        get_settings.cache_clear()


def test_seeded_farm_membership_is_idempotent(client) -> None:
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, Property, User
    from app.services.seeding import run_seeding
    from sqlalchemy import func, select

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.full_name == "Roar Meen")).scalar_one()
        first_property = db.execute(
            select(Property).where(Property.user_id == user.id).order_by(Property.id)
        ).scalars().first()
        assert first_property is not None

        run_seeding(db)
        run_seeding(db)

        membership = db.execute(
            select(FarmMembership).where(FarmMembership.user_id == user.id)
        ).scalar_one()
        farm = db.get(Farm, membership.farm_id)
        membership_count = db.scalar(
            select(func.count()).select_from(FarmMembership).where(FarmMembership.user_id == user.id)
        )

    assert farm is not None
    assert membership.role == "owner"
    assert membership.status == "active"
    assert first_property.farm_id == farm.id
    assert membership_count == 1


def test_seeding_does_not_reactivate_revoked_membership(client) -> None:
    from app.database import SessionLocal
    from app.models import FarmMembership, User
    from app.services.seeding import run_seeding
    from sqlalchemy import select

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.full_name == "Roar Meen")).scalar_one()
        membership = db.execute(
            select(FarmMembership).where(FarmMembership.user_id == user.id)
        ).scalar_one()
        membership.status = "revoked"
        db.commit()

        run_seeding(db)
        db.refresh(membership)

        assert membership.role == "owner"
        assert membership.status == "revoked"


def test_sqlite_rejects_orphaned_tenant_references(client) -> None:
    from app.database import SessionLocal
    from app.models import FarmMembership, Property, User
    from sqlalchemy import select, text

    with SessionLocal() as db:
        assert db.execute(text("PRAGMA foreign_keys")).scalar_one() == 1
        user = db.execute(select(User).order_by(User.id)).scalars().first()
        assert user is not None
        db.add(
            Property(
                user_id=user.id,
                farm_id=999_999,
                komm="4003",
                gnr=999,
                bnr=1,
                fnr=0,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()

        db.add(
            FarmMembership(
                farm_id=999_999,
                user_id=user.id,
                role="viewer",
                status="invited",
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()


def test_membership_status_cannot_be_omitted(client) -> None:
    from app.database import SessionLocal
    from app.models import FarmMembership, User
    from sqlalchemy import select

    with SessionLocal() as db:
        user = User(full_name="Invitert uten status")
        db.add(user)
        db.flush()
        farm_id = db.execute(select(FarmMembership.farm_id).limit(1)).scalar_one()
        db.add(FarmMembership(farm_id=farm_id, user_id=user.id, role="viewer"))
        with pytest.raises(IntegrityError):
            db.commit()


def test_writable_farm_selection_ignores_read_limited_memberships(client) -> None:
    from app.api.v1 import _active_writable_farm_id_for_user
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, User

    with SessionLocal() as db:
        user = User(full_name="Bruker med flere gårder")
        read_limited_farm = Farm(name="Rådgivergård")
        writable_farm = Farm(name="Driftsgård")
        db.add_all([user, read_limited_farm, writable_farm])
        db.flush()
        db.add(
            FarmMembership(
                farm_id=read_limited_farm.id,
                user_id=user.id,
                role="viewer",
                status="active",
            )
        )
        db.flush()
        db.add(
            FarmMembership(
                farm_id=writable_farm.id,
                user_id=user.id,
                role="operator",
                status="active",
            )
        )
        db.commit()

        assert _active_writable_farm_id_for_user(db, user.id) == writable_farm.id


def test_profile_cannot_add_property_through_read_limited_primary_farm(client) -> None:
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, Property, User
    from sqlalchemy import func, select

    with SessionLocal() as db:
        user = db.execute(select(User).where(User.full_name == "Roar Meen")).scalar_one()
        primary_property = db.execute(
            select(Property).where(Property.user_id == user.id).order_by(Property.id)
        ).scalars().first()
        assert primary_property is not None
        primary_membership = db.execute(
            select(FarmMembership).where(
                FarmMembership.user_id == user.id,
                FarmMembership.farm_id == primary_property.farm_id,
            )
        ).scalar_one()
        primary_membership.role = "viewer"
        writable_farm = Farm(name="Annen skrivbar gård")
        db.add(writable_farm)
        db.flush()
        db.add(
            FarmMembership(
                farm_id=writable_farm.id,
                user_id=user.id,
                role="operator",
                status="active",
            )
        )
        user_id = user.id
        property_count_before = db.scalar(
            select(func.count()).select_from(Property).where(Property.user_id == user_id)
        )
        db.commit()

    response = client.patch(
        "/api/v1/profile/current",
        json={
            "additional_properties": [
                {
                    "label": "Skal avvises",
                    "komm": "4003",
                    "gnr": 77,
                    "bnr": 7,
                    "fnr": 0,
                }
            ]
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Brukeren mangler skrivbart gårdsmedlemskap"
    with SessionLocal() as db:
        property_count_after = db.scalar(
            select(func.count()).select_from(Property).where(Property.user_id == user_id)
        )
    assert property_count_after == property_count_before


@pytest.mark.parametrize(
    ("role", "status"),
    [
        ("superadmin", "active"),
        ("owner", "pending"),
    ],
)
def test_membership_rejects_values_outside_contract(client, role: str, status: str) -> None:
    from app.database import SessionLocal
    from app.models import FarmMembership, User
    from sqlalchemy import select

    with SessionLocal() as db:
        user = User(full_name=f"Ugyldig {role} {status}")
        db.add(user)
        db.flush()
        existing_farm_id = db.execute(select(FarmMembership.farm_id).limit(1)).scalar_one()
        db.add(
            FarmMembership(
                farm_id=existing_farm_id,
                user_id=user.id,
                role=role,
                status=status,
            )
        )
        with pytest.raises(IntegrityError):
            db.commit()
