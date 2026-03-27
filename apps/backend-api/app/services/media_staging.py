from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..models import MediaStagingJob, MediaStagingItem


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
