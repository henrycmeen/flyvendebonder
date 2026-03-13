#!/usr/bin/env python3
from __future__ import annotations

import argparse
import logging
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

sys.path.append(str(Path(__file__).resolve().parent.parent / "apps" / "backend-api"))

from app.config import get_settings  # noqa: E402
from app.database import SessionLocal, run_migrations  # noqa: E402
from app.models import Photo, PhotoAsset  # noqa: E402
from app.services.metadata_utils import extract_metadata, resolve_photo_altitude  # noqa: E402
from sqlalchemy import select

logger = logging.getLogger(__name__)
def _log(message: str) -> None:
    print(message)


@dataclass
class Summary:
    checked: int = 0
    updated: int = 0
    missing_asset: int = 0
    missing_metadata: int = 0
    parse_failed: int = 0
    missing_pitch: int = 0
    source_lookup_used: int = 0
    source_lookup_missing: int = 0
    altitude_updated: int = 0


def _choose_heading(photo_meta: Any) -> float | None:
    for value in (
        photo_meta.flight_yaw_degree,
        photo_meta.gimbal_yaw_degree,
        photo_meta.camera_yaw_degree,
        photo_meta.compass,
        photo_meta.heading_deg,
    ):
        if value is not None:
            return float(value)
    return None


def _choose_pitch(photo_meta: Any) -> float | None:
    for value in (
        photo_meta.gimbal_pitch_degree,
        photo_meta.flight_pitch_degree,
        photo_meta.camera_pitch_degree,
    ):
        if value is not None:
            return float(value)
    return None


def _resolve_original_asset(photo: Photo) -> Path | None:
    settings = get_settings()
    for asset in photo.assets:
        if asset.kind == "original":
            rel_path = asset.path
            if rel_path.startswith("photos/"):
                rel_path = rel_path.removeprefix("photos/")
            return settings.photos_root / rel_path
    return None


def _build_source_index(source_root: Path) -> dict[str, Path]:
    index: dict[str, Path] = {}
    if not source_root.exists() or not source_root.is_dir():
        return index

    for path in source_root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() not in {".jpg", ".jpeg", ".tif", ".tiff"}:
            continue
        name = path.name.lower()
        # Keep the first hit for deterministic fallback.
        if name not in index:
            index[name] = path
    return index


def _candidate_source_names(photo: Photo) -> list[str]:
    candidates: list[str] = []
    source_name = (photo.source_filename or "").strip()
    if source_name:
        candidates.append(source_name)

    searchable = [source_name, photo.id]
    for value in searchable:
        if not value:
            continue
        match = re.search(r"(20\d{12})[_-](\d{4})[_-][dD]", value)
        if match:
            stamp = match.group(1)
            seq = match.group(2)
            candidates.extend(
                [
                    f"DJI_{stamp}_{seq}_D.JPG",
                    f"DJI_{stamp}_{seq}_D.jpg",
                    f"dji_{stamp}_{seq}_d.jpg",
                    f"dji_{stamp}_{seq}_d.jpeg",
                ]
            )

    # Preserve order, drop duplicates.
    seen: set[str] = set()
    deduped: list[str] = []
    for item in candidates:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _resolve_source_fallback(photo: Photo, source_index: dict[str, Path]) -> Path | None:
    for name in _candidate_source_names(photo):
        match = source_index.get(name.lower())
        if match is not None:
            return match
    return None


def _run(dry_run: bool, force: bool, user_id: int | None, limit: int | None) -> Summary:
    settings = get_settings()
    if settings.photos_root.exists():
        logger.info("Bruker bilder fra %s", settings.photos_root)
    source_index = _build_source_index(settings.imports_default_source)
    if source_index:
        logger.info(
            "Klarte fallback-indeks fra %s (%s filer)",
            settings.imports_default_source,
            len(source_index),
        )
    else:
        logger.warning("Fant ingen fallback-kildefiler i %s", settings.imports_default_source)

    db = SessionLocal()
    stmt = (
        select(Photo)
        .join(PhotoAsset, PhotoAsset.photo_id == Photo.id)
        .where(PhotoAsset.kind == "original")
    )
    if user_id is not None:
        stmt = stmt.where(Photo.user_id == user_id)
    photos = db.execute(stmt.distinct()).scalars().all()

    summary = Summary()
    if limit:
        photos = photos[:limit]

    for photo in photos:
        summary.checked += 1
        original_path = _resolve_original_asset(photo)
        if not original_path:
            summary.missing_asset += 1
            continue
        if not original_path.exists():
            _log(f"Originalfil mangler: {original_path}")
            summary.parse_failed += 1
            continue

        try:
            metadata = extract_metadata(original_path)
        except Exception as exc:  # noqa: BLE001
            _log(f"Kunne ikke parse {photo.id}: {exc}")
            summary.parse_failed += 1
            continue

        heading = _choose_heading(metadata)
        pitch = _choose_pitch(metadata)
        if heading is None or pitch is None:
            fallback_path = _resolve_source_fallback(photo, source_index)
            if fallback_path is not None:
                try:
                    fallback_meta = extract_metadata(fallback_path)
                    if heading is None:
                        heading = _choose_heading(fallback_meta)
                    if pitch is None:
                        pitch = _choose_pitch(fallback_meta)
                    summary.source_lookup_used += 1
                except Exception as exc:  # noqa: BLE001
                    _log(f"Fallback metadata-feil for {photo.id}: {exc}")
                    summary.parse_failed += 1
            else:
                summary.source_lookup_missing += 1

        if heading is None:
            summary.missing_metadata += 1
            continue
        if pitch is None:
            summary.missing_pitch += 1

        changed = False

        corrected_altitude = resolve_photo_altitude(photo.altitude_m, metadata)
        if corrected_altitude is not None and corrected_altitude != photo.altitude_m:
            photo.altitude_m = corrected_altitude
            summary.altitude_updated += 1
            changed = True

        if heading != photo.heading_deg:
            photo.heading_deg = heading
            changed = True

        if pitch != photo.pitch_deg:
            photo.pitch_deg = pitch
            changed = True

        if changed:
            summary.updated += 1
            if force and not dry_run:
                db.add(photo)

    if force and not dry_run:
        db.commit()
    else:
        db.rollback()

    db.close()
    return summary


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfyll heading_deg i Photo basert på originalfiler."
    )
    parser.add_argument("--dry-run", action="store_true", help="Vis bare hvilke bilder som blir oppdatert.")
    parser.add_argument("--force", action="store_true", help="Gjennomfør lagring til database (kreves med --dry-run false).")
    parser.add_argument("--user-id", type=int, default=None, help="Begrens til bruker-ID.")
    parser.add_argument("--limit", type=int, default=None, help="Kun første N bilder.")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    run_migrations()

    should_commit = args.force and not args.dry_run
    if args.dry_run and args.force:
        logger.warning("--dry-run ignorerer --force; setter force=False.")
        should_commit = False

    if not should_commit and not args.dry_run:
        logger.info("Ingen commit i standardkjøring. Legg ved --force for faktisk oppdatering.")

    if args.force and args.dry_run:
        args.force = False

    dry_run = args.dry_run or not args.force
    summary = _run(dry_run=dry_run, force=args.force and not args.dry_run, user_id=args.user_id, limit=args.limit)

    _log(f"Sjekket: {summary.checked}")
    _log(f"Oppdatert (planlagt): {summary.updated}")
    _log(f"Manglende original: {summary.missing_asset}")
    _log(f"Manglende metadata: {summary.missing_metadata}")
    _log(f"Mangler pitch: {summary.missing_pitch}")
    _log(f"Relativ høyde oppdatert: {summary.altitude_updated}")
    _log(f"Fallback kilde brukt: {summary.source_lookup_used}")
    _log(f"Fallback kilde ikke funnet: {summary.source_lookup_missing}")
    _log(f"Parse-feil: {summary.parse_failed}")
    _log(
        "Endringer skrevet til DB." if args.force and not args.dry_run else "Ingen endringer skrevet (dry-run)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
