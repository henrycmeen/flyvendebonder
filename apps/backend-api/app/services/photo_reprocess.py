from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..models import Photo
from .analysis_enrich import enrich_photo
from .metadata_utils import (
    extract_metadata,
    resolve_photo_altitude,
    select_heading_from_metadata,
    select_pitch_from_metadata,
)

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class PhotoReprocessSummary:
    requested: int = 0
    metadata_updated: int = 0
    analysis_processed: int = 0
    analysis_failed: int = 0
    missing_original: int = 0
    parse_failed: int = 0


def _resolve_original_asset_path(photo: Photo) -> Path | None:
    for asset in photo.assets:
        if asset.kind != "original":
            continue

        rel_path = asset.path
        if rel_path.startswith("photos/"):
            rel_path = rel_path.removeprefix("photos/")
        return settings.photos_root / rel_path
    return None


def reprocess_photos_for_user(
    db: Session,
    *,
    user_id: int,
    refresh_analysis: bool = True,
    force_analysis: bool = True,
) -> dict[str, int]:
    photos = db.execute(
        select(Photo)
        .where(Photo.user_id == user_id)
        .options(selectinload(Photo.assets))
        .order_by(Photo.captured_at, Photo.id)
    ).scalars().all()

    summary = PhotoReprocessSummary(requested=len(photos))

    for photo in photos:
        metadata_changed = False
        metadata = None
        original_path = _resolve_original_asset_path(photo)

        if original_path is None or not original_path.exists():
            summary.missing_original += 1
        else:
            try:
                metadata = extract_metadata(original_path)
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Kunne ikke reparse original metadata",
                    extra={"photo_id": photo.id, "error": str(exc)},
                )
                summary.parse_failed += 1

        if metadata is not None:
            heading = select_heading_from_metadata(metadata).value
            pitch = select_pitch_from_metadata(metadata).value
            altitude = resolve_photo_altitude(photo.altitude_m, metadata)

            if heading is not None and heading != photo.heading_deg:
                photo.heading_deg = heading
                metadata_changed = True

            if pitch is not None and pitch != photo.pitch_deg:
                photo.pitch_deg = pitch
                metadata_changed = True

            if altitude is not None and altitude != photo.altitude_m:
                photo.altitude_m = altitude
                metadata_changed = True

            if metadata_changed:
                summary.metadata_updated += 1

        if refresh_analysis:
            try:
                enrich_photo(db, photo, force=force_analysis)
                summary.analysis_processed += 1
            except Exception as exc:  # noqa: BLE001
                logger.exception(
                    "Analyse feilet under photo reprocess",
                    extra={"photo_id": photo.id, "error": str(exc)},
                )
                summary.analysis_failed += 1
        elif metadata_changed:
            db.add(photo)
            db.commit()
            db.refresh(photo)

    return {
        "requested": summary.requested,
        "metadata_updated": summary.metadata_updated,
        "analysis_processed": summary.analysis_processed,
        "analysis_failed": summary.analysis_failed,
        "missing_original": summary.missing_original,
        "parse_failed": summary.parse_failed,
    }
