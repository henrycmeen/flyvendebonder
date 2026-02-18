from __future__ import annotations

import argparse
from pathlib import Path

from app.database import SessionLocal, run_migrations
from app.services.imports import run_photo_ingest
from app.services.seeding import run_seeding


def main() -> int:
    parser = argparse.ArgumentParser(description="Importer bilder til Flyvendebonder backend")
    parser.add_argument("source", type=Path, nargs="?", help="Kildekatalog med bilder")
    args = parser.parse_args()

    run_migrations()

    with SessionLocal() as db:
        run_seeding(db)
        if args.source is None:
            raise SystemExit("Mangler source-katalog")

        run = run_photo_ingest(db, args.source)

    print(f"Ingest run {run.id} ferdig")
    print(f"Seen={run.files_seen} imported={run.files_imported} skipped={run.files_skipped}")
    if run.errors_json and run.errors_json != "[]":
        print(f"Errors: {run.errors_json}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
