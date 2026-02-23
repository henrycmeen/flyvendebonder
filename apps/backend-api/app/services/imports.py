from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import date, datetime
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import IngestRun, Photo, PhotoAsset, Property, User
from .metadata_utils import (
    ExtractedMetadata as FileMetadata,
    _serialize_orientation_candidates,
    select_heading_from_metadata,
    select_pitch_from_metadata,
    derive_ground_sampling,
    extract_metadata as extract_image_metadata,
)
from .image_derivatives import write_derivatives
from .tag_utils import serialize_tag_groups

logger = logging.getLogger(__name__)
settings = get_settings()

SUPPORTED_EXTS = {".jpg", ".jpeg", ".tif", ".tiff"}


def _sha256(file_path: Path) -> str:
    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or "photo"


def _extract_metadata(path: Path) -> FileMetadata:
    return extract_image_metadata(path)


def _derive_quality_tags(metadata_issues: list[str]) -> list[str]:
    qc_tags: set[str] = set()
    for issue in metadata_issues:
        normalized = issue.lower()
        if "retning" in normalized:
            qc_tags.add("qc:missing_heading")
        elif "pitch" in normalized:
            qc_tags.add("qc:missing_pitch")
        elif "date" in normalized:
            qc_tags.add("qc:missing_timestamp")
        elif "gps" in normalized:
            qc_tags.add("qc:missing_gps")
        elif "høyde" in normalized or "altitude" in normalized:
            qc_tags.add("qc:missing_altitude")
        else:
            qc_tags.add("qc:metadata_issue")

    return sorted(qc_tags)


def _default_targets(db: Session) -> tuple[User, Property | None]:
    user = db.execute(select(User).order_by(User.id)).scalars().first()
    if not user:
        raise ValueError("Ingen bruker i databasen")

    property_obj = (
        db.execute(
            select(Property)
            .where(Property.user_id == user.id)
            .where((Property.active_to.is_(None)) | (Property.active_to >= date.today()))
            .order_by(Property.id)
        )
        .scalars()
        .first()
    )
    return user, property_obj


def run_photo_ingest(db: Session, source_path: Path) -> IngestRun:
    if not source_path.exists() or not source_path.is_dir():
        raise FileNotFoundError(f"Katalog finnes ikke: {source_path}")

    user, property_obj = _default_targets(db)
    run = IngestRun(source_path=str(source_path), started_at=datetime.utcnow())
    db.add(run)
    db.commit()
    db.refresh(run)

    files = sorted([path for path in source_path.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTS])
    errors: list[dict] = []
    seen = imported = skipped = 0

    for file_path in files:
        seen += 1
        try:
            source_hash = _sha256(file_path)

            existing = db.execute(select(Photo).where(Photo.source_hash == source_hash)).scalars().first()
            if existing:
                skipped += 1
                continue

            metadata = _extract_metadata(file_path)
            quality_flags = _derive_quality_tags(metadata.issues)
            heading_selection = select_heading_from_metadata(metadata)
            pitch_selection = select_pitch_from_metadata(metadata)
            quality_flags.extend([tag for tag in heading_selection.qc_tags if tag not in quality_flags])
            quality_flags.extend([tag for tag in pitch_selection.qc_tags if tag not in quality_flags])
            needs_manual_qc = bool(quality_flags)
            gsd_m, image_footprint_w_m, track_spacing_m, overlap_front, overlap_side, oblique_correction_applied = derive_ground_sampling(
                metadata
            )
            if gsd_m is None:
                quality_flags.append("qc:missing_gsd_input")
                needs_manual_qc = True

            heading_value = heading_selection.value
            heading_source = heading_selection.source
            pitch_value = pitch_selection.value
            heading_candidates = _serialize_orientation_candidates(heading_selection.candidates)
            pitch_candidates = _serialize_orientation_candidates(pitch_selection.candidates)
            if metadata.captured_at is None or metadata.gps_latitude is None or metadata.gps_longitude is None:
                raise ValueError("Mangler tid eller koordinater i metadataparsing")

            secondary = db.execute(
                select(Photo).where(
                    Photo.source_filename == file_path.name,
                    Photo.captured_at == metadata.captured_at,
                    Photo.lat == metadata.gps_latitude,
                    Photo.lng == metadata.gps_longitude,
                )
            ).scalars().first()
            if secondary:
                skipped += 1
                continue

            slug = _slugify(file_path.stem)
            photo_id = f"{slug}-{source_hash[:10]}"
            assets = write_derivatives(file_path, source_hash)

            photo = Photo(
                id=photo_id,
                user_id=user.id,
                property_id=property_obj.id if property_obj else None,
                captured_at=metadata.captured_at,
                captured_date=metadata.captured_at.date(),
                lat=metadata.gps_latitude,
                lng=metadata.gps_longitude,
                altitude_m=metadata.altitude_m,
                heading_deg=heading_value,
                pitch_deg=pitch_value,
                gsd_m=gsd_m,
                image_footprint_w_m=image_footprint_w_m,
                track_spacing_m=track_spacing_m,
                overlap_front=overlap_front,
                overlap_side=overlap_side,
                oblique_correction_applied=oblique_correction_applied,
                source_filename=file_path.name,
                source_hash=source_hash,
                notes=f"Importert fra {file_path.parent.name}",
                tags_json=serialize_tag_groups(
                    user_tags=[
                        "meen-gard",
                        "dronefoto",
                        file_path.parent.name,
                    ],
                    system_tags=[
                        f"meta:heading_source={heading_source}",
                        f"meta:heading_source_detail={heading_selection.source_detail}",
                        f"meta:pitch_source={pitch_selection.source}",
                        f"meta:pitch_source_detail={pitch_selection.source_detail}",
                        f"meta:heading_source_candidates={heading_candidates}" if heading_candidates else None,
                        f"meta:pitch_source_candidates={pitch_candidates}" if pitch_candidates else None,
                        *quality_flags,
                        "qc:needs_manual_qc" if needs_manual_qc else None,
                    ],
                ),
            )

            db.add(photo)
            db.flush()

            for asset in assets:
                db.add(
                    PhotoAsset(
                        photo_id=photo.id,
                        kind=asset["kind"],
                        path=asset["path"],
                        mime=asset["mime"],
                        bytes=asset["bytes"],
                        width=asset["width"],
                        height=asset["height"],
                    )
                )

            db.commit()
            imported += 1
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            skipped += 1
            errors.append({"file": str(file_path), "error": str(exc)})
            logger.exception("Importfeil", extra={"file": str(file_path), "error": str(exc)})

    run.files_seen = seen
    run.files_imported = imported
    run.files_skipped = skipped
    run.errors_json = json.dumps(errors, ensure_ascii=False)
    run.finished_at = datetime.utcnow()
    db.commit()
    db.refresh(run)

    return run
