#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging

from app.database import SessionLocal, run_migrations
from app.services.heading_backfill import infer_missing_headings_for_user


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill heading_deg fra flysekvens når EXIF-heading mangler.")
    parser.add_argument("--user-id", type=int, default=1, help="Begrens til bruker-ID.")
    parser.add_argument("--min-distance-m", type=float, default=8.0, help="Minste avstand mellom punkter for å bruke heading-estimat.")
    parser.add_argument("--max-gap-seconds", type=float, default=1800.0, help="Maks tidsavstand mellom nabobilder i samme sekvens.")
    parser.add_argument("--force", action="store_true", help="Skriv endringer til databasen.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    run_migrations()

    with SessionLocal() as db:
        summary = infer_missing_headings_for_user(
            db,
            user_id=args.user_id,
            min_distance_m=args.min_distance_m,
            max_gap_seconds=args.max_gap_seconds,
            commit=args.force,
        )

    print(f"Totalt: {summary['total']}")
    print(f"Oppdatert: {summary['updated']}")
    print(f"Hadde heading fra før: {summary['skipped_has_heading']}")
    print(f"Kunne ikke estimere: {summary['skipped_no_estimate']}")
    print("Endringer skrevet til DB." if args.force else "Ingen endringer skrevet (dry-run).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
