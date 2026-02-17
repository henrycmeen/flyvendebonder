from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent
DB_PATH = APP_DIR / "data" / "flyvendebonder.db"


def get_connection() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    with get_connection() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_name TEXT NOT NULL,
                phone TEXT,
                email TEXT,
                address_line1 TEXT,
                postal_code TEXT,
                city TEXT,
                municipality_code TEXT,
                municipality_name TEXT,
                farm_number INTEGER,
                usage_number INTEGER,
                lease_number INTEGER DEFAULT 0,
                notes TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_users_name ON users(full_name);
            CREATE INDEX IF NOT EXISTS idx_users_property ON users(municipality_code, farm_number, usage_number, lease_number);
            """
        )


def seed_default_user() -> None:
    with get_connection() as connection:
        exists = connection.execute(
            """
            SELECT id FROM users
            WHERE full_name = ?
              AND municipality_code = ?
              AND farm_number = ?
              AND usage_number = ?
              AND COALESCE(lease_number, 0) = ?
            LIMIT 1
            """,
            ("Roar Meen", "3807", 70, 17, 0),
        ).fetchone()

        if exists:
            return

        connection.execute(
            """
            INSERT INTO users (
                full_name,
                phone,
                email,
                address_line1,
                postal_code,
                city,
                municipality_code,
                municipality_name,
                farm_number,
                usage_number,
                lease_number,
                notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "Roar Meen",
                None,
                None,
                None,
                None,
                "Skien",
                "3807",
                "Skien",
                70,
                17,
                0,
                "Kundeprofil opprettet automatisk. Oppdater adresse og telefon.",
            ),
        )


def row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "full_name": row["full_name"],
        "phone": row["phone"],
        "email": row["email"],
        "address_line1": row["address_line1"],
        "postal_code": row["postal_code"],
        "city": row["city"],
        "municipality_code": row["municipality_code"],
        "municipality_name": row["municipality_name"],
        "farm_number": row["farm_number"],
        "usage_number": row["usage_number"],
        "lease_number": row["lease_number"],
        "notes": row["notes"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }
