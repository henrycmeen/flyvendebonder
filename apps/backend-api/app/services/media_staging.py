from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import MediaStagingJob, MediaStagingItem
from .imports import SUPPORTED_EXTS, run_photo_ingest
from .video_jobs import create_video_job, find_video_job_by_staging_item


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".avi", ".mkv"}
IMAGE_MIME_PREFIXES = ("image/",)
VIDEO_MIME_PREFIXES = ("video/",)


def _utc_now() -> datetime:
    return datetime.utcnow()


def _normalized_filename(raw_name: str | None, index: int) -> str:
    candidate = Path(raw_name or f"upload-{index:03d}").name.strip()
    return candidate or f"upload-{index:03d}"


def _classify_media(*, filename: str, mime: str | None) -> tuple[str, str, str | None]:
    suffix = Path(filename).suffix.lower()
    normalized_mime = (mime or "").strip().lower()
    if suffix in IMAGE_EXTENSIONS or normalized_mime.startswith(IMAGE_MIME_PREFIXES):
        return "image", "staged", None
    if suffix in VIDEO_EXTENSIONS or normalized_mime.startswith(VIDEO_MIME_PREFIXES):
        return "video", "staged", None
    return "unknown", "rejected", "Ukjent eller ikke-støttet filtype"


def staging_job_dir(app_data_root: Path, job_id: str) -> Path:
    return app_data_root / "media-staging" / job_id


async def create_media_staging_job(
    db: Session,
    *,
    app_data_root: Path,
    user_id: int,
    property_id: int | None,
    files: list[UploadFile],
) -> MediaStagingJob:
    job_id = uuid4().hex
    created_at = _utc_now()
    root = staging_job_dir(app_data_root, job_id)
    root.mkdir(parents=True, exist_ok=True)

    job = MediaStagingJob(
        id=job_id,
        user_id=user_id,
        property_id=property_id,
        source="upload",
        status="staged",
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(job)
    db.flush()

    for index, upload in enumerate(files):
        filename = _normalized_filename(upload.filename, index)
        media_kind, item_status, error_detail = _classify_media(filename=filename, mime=upload.content_type)
        staged_name = f"{index:03d}-{filename}"
        target = root / staged_name
        digest = hashlib.sha256()
        byte_count = 0

        with target.open("wb") as handle:
            while True:
                chunk = await upload.read(1024 * 1024)
                if not chunk:
                    break
                handle.write(chunk)
                digest.update(chunk)
                byte_count += len(chunk)
        await upload.close()

        db.add(
            MediaStagingItem(
                job_id=job.id,
                item_order=index,
                filename=filename,
                mime=upload.content_type,
                bytes=byte_count,
                checksum=digest.hexdigest() if byte_count else None,
                media_kind=media_kind,
                status=item_status,
                error_detail=error_detail,
                staged_path=str(target.relative_to(app_data_root)),
                created_at=created_at,
                updated_at=created_at,
            )
        )

    db.commit()
    return get_media_staging_job(db, user_id=user_id, job_id=job_id)


def get_media_staging_job(db: Session, *, user_id: int, job_id: str) -> MediaStagingJob | None:
    return (
        db.execute(
            select(MediaStagingJob)
            .options(selectinload(MediaStagingJob.items))
            .where(MediaStagingJob.id == job_id, MediaStagingJob.user_id == user_id)
        )
        .scalars()
        .first()
    )


def list_media_staging_jobs(
    db: Session,
    *,
    user_id: int,
    limit: int = 20,
) -> list[MediaStagingJob]:
    return list(
        db.execute(
            select(MediaStagingJob)
            .options(selectinload(MediaStagingJob.items))
            .where(MediaStagingJob.user_id == user_id)
            .order_by(MediaStagingJob.created_at.desc(), MediaStagingJob.id.desc())
            .limit(limit)
        )
        .scalars()
        .all()
    )


def finalize_media_staging_job(
    db: Session,
    *,
    app_data_root: Path,
    user_id: int,
    job_id: str,
) -> dict:
    job = get_media_staging_job(db, user_id=user_id, job_id=job_id)
    if job is None:
        raise ValueError("Fant ikke stagingjobb")

    cached_result = json.loads(job.finalize_result_json or "{}")
    if job.status == "finalized" and cached_result:
        return cached_result
    if job.status != "staged":
        raise ValueError("Stagingjobben kan ikke finaliseres i nåværende status")

    image_items = [item for item in job.items if item.media_kind == "image"]
    video_items = [item for item in job.items if item.media_kind == "video"]
    rejected_items = [item for item in job.items if item.status == "rejected" or item.media_kind == "unknown"]

    from ..models import Photo  # local import to avoid broad module coupling

    existing_photos = (
        db.execute(
            select(Photo).where(Photo.source_hash.in_([item.checksum for item in image_items if item.checksum]))
        )
        .scalars()
        .all()
        if image_items
        else []
    )
    existing_photo_by_checksum = {item.source_hash: item for item in existing_photos}

    staging_root = staging_job_dir(app_data_root, job.id)
    import_run = None
    if any(Path(item.filename).suffix.lower() in SUPPORTED_EXTS for item in image_items):
        import_run = run_photo_ingest(
            db,
            staging_root,
            user_id=job.user_id,
            property_id=job.property_id,
        )

    imported_photos = (
        db.execute(
            select(Photo).where(Photo.source_hash.in_([item.checksum for item in image_items if item.checksum]))
        )
        .scalars()
        .all()
        if image_items
        else []
    )
    imported_photo_by_checksum = {item.source_hash: item for item in imported_photos}

    item_results: list[dict] = []
    for item in image_items:
        suffix = Path(item.filename).suffix.lower()
        if suffix not in SUPPORTED_EXTS:
            item_results.append(
                {
                    "staging_item_id": item.id,
                    "filename": item.filename,
                    "media_kind": item.media_kind,
                    "status": "failed",
                    "photo_id": None,
                    "video_job_id": None,
                    "detail": "Bildeformatet støttes ikke av importløypa ennå",
                }
            )
            continue
        photo = imported_photo_by_checksum.get(item.checksum or "")
        was_existing = item.checksum in existing_photo_by_checksum
        item_results.append(
            {
                "staging_item_id": item.id,
                "filename": item.filename,
                "media_kind": item.media_kind,
                "status": "skipped" if was_existing else "imported",
                "photo_id": photo.id if photo is not None else None,
                "video_job_id": None,
                "detail": "Bildet fantes allerede" if was_existing else None,
            }
        )

    for item in video_items:
        existing_job = find_video_job_by_staging_item(
            db,
            user_id=job.user_id,
            staging_job_id=job.id,
            staging_item_id=item.id,
        )
        if existing_job is not None:
            item_results.append(
                {
                    "staging_item_id": item.id,
                    "filename": item.filename,
                    "media_kind": item.media_kind,
                    "status": "reused",
                    "photo_id": None,
                    "video_job_id": existing_job.id,
                    "detail": "Videojobb fantes allerede for staging-itemet",
                }
            )
            continue
        created_job = create_video_job(
            db,
            app_data_root=app_data_root,
            user_id=job.user_id,
            property_id=job.property_id,
            filename=item.filename,
            mode="frames",
            config={
                "process": "frames",
                "source": {
                    "type": "media_staging_finalize_v1",
                    "staging_job_id": job.id,
                    "staging_item_id": item.id,
                    "staged_path": item.staged_path,
                    "checksum": item.checksum,
                },
            },
        )
        item_results.append(
            {
                "staging_item_id": item.id,
                "filename": item.filename,
                "media_kind": item.media_kind,
                "status": "created",
                "photo_id": None,
                "video_job_id": created_job.id,
                "detail": None,
            }
        )

    for item in rejected_items:
        item_results.append(
            {
                "staging_item_id": item.id,
                "filename": item.filename,
                "media_kind": item.media_kind,
                "status": "rejected",
                "photo_id": None,
                "video_job_id": None,
                "detail": item.error_detail or "Filen ble avvist i staging",
            }
        )

    result = {
        "job_id": job.id,
        "status": "finalized",
        "import_run_id": import_run.id if import_run is not None else None,
        "image_imported_count": sum(1 for item in item_results if item["status"] == "imported"),
        "image_skipped_count": sum(1 for item in item_results if item["status"] == "skipped"),
        "video_jobs_created": sum(1 for item in item_results if item["status"] == "created"),
        "video_jobs_reused": sum(1 for item in item_results if item["status"] == "reused"),
        "rejected_count": sum(1 for item in item_results if item["status"] == "rejected"),
        "items": item_results,
    }

    job.status = "finalized"
    job.finalized_at = _utc_now()
    job.finalize_result_json = json.dumps(result, ensure_ascii=False)
    job.updated_at = _utc_now()
    db.add(job)
    db.commit()
    return result
