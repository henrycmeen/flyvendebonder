from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Generator

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from .config import BASE_DIR, get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _alembic_config() -> Config:
    cfg = Config(str(BASE_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BASE_DIR / "alembic"))
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    return cfg


def _sqlite_path_from_url(url: str) -> Path | None:
    if not url.startswith("sqlite:///"):
        return None
    return Path(url.removeprefix("sqlite:///"))


def _needs_sqlite_reset(path: Path) -> bool:
    if not path.exists():
        return False

    with sqlite3.connect(path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
        if not tables:
            return False

        if "alembic_version" in tables:
            rows = conn.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchall()
            if rows:
                return False

        # Legacy/partial databases from earlier prototypes often only have users table.
        if "users" in tables and "properties" not in tables:
            return True

        # Any non-empty schema without Alembic version should be treated as legacy/partial.
        if tables and "alembic_version" not in tables:
            return True

        if "alembic_version" in tables:
            rows = conn.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchall()
            return len(rows) == 0

    return False


def _backup_sqlite(path: Path) -> None:
    timestamp = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
    backup_path = path.with_suffix(f".backup-{timestamp}.db")
    path.rename(backup_path)


def run_migrations() -> None:
    sqlite_path = _sqlite_path_from_url(settings.database_url)
    if sqlite_path is not None:
        sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        if _needs_sqlite_reset(sqlite_path):
            _backup_sqlite(sqlite_path)

    command.upgrade(_alembic_config(), "head")
