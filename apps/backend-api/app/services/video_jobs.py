from __future__ import annotations

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

from PIL import Image, ImageDraw
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from ..models import VideoJob, VideoJobReview


def _utc_now() -> datetime:
    return datetime.utcnow()


def job_dir(app_data_root: Path, job_id: str) -> Path:
    return app_data_root / "video-jobs" / job_id


def job_public_path(job_id: str, filename: str) -> str:
    return f"/api/v1/video-jobs/{job_id}/{filename}"


def _job_coordinates(seed: str) -> list[list[float]]:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    lat = 59.12 + (digest[0] / 2550.0)
    lng = 9.98 + (digest[1] / 2550.0)
    return [
        [round(lng, 6), round(lat, 6)],
        [round(lng + 0.0012, 6), round(lat + 0.0004, 6)],
        [round(lng + 0.0024, 6), round(lat + 0.0011, 6)],
    ]


def _write_preview(path: Path, label: str) -> None:
    image = Image.new("RGB", (1280, 720), color=(36, 68, 102))
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 1230, 670), outline=(225, 232, 240), width=6)
    draw.text((90, 100), "Flyvendebonder videojobb", fill=(245, 248, 252))
    draw.text((90, 160), label, fill=(245, 248, 252))
    draw.text((90, 220), "Kontrakt-v1 placeholder for frames-modus", fill=(214, 224, 234))
    image.save(path, format="JPEG", quality=82)


def _placeholder_result_frames(job_id: str) -> dict[str, Any]:
    preview_url = job_public_path(job_id, "preview.jpg")
    return {
        "frame_count": 90,
        "fps": 2,
        "selected_frame_count": 3,
        "route_distance_m": 215.0,
        "step_distance_m": 72.0,
        "sample_frames": [
            {"index": 0, "timestamp_ms": 0, "image_url": preview_url},
            {"index": 30, "timestamp_ms": 15000, "image_url": preview_url},
            {"index": 60, "timestamp_ms": 30000, "image_url": preview_url},
        ],
        "archive_url": None,
    }


def _write_placeholder_artifacts(
    *,
    app_data_root: Path,
    job_id: str,
    filename: str,
    mode: str,
    config: dict[str, Any],
    created_at: datetime,
) -> None:
    path = job_dir(app_data_root, job_id)
    path.mkdir(parents=True, exist_ok=True)

    preview_path = path / "preview.jpg"
    metadata_path = path / "metadata.json"
    geodata_path = path / "geodata.geojson"

    coordinates = _job_coordinates(f"{filename}:{job_id}")
    _write_preview(preview_path, filename)

    geodata = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "job_id": job_id,
                    "mode": mode,
                    "is_placeholder": True,
                    "source_filename": filename,
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
            }
        ],
    }
    metadata = {
        "job_id": job_id,
        "mode": mode,
        "source_filename": filename,
        "provider": "video_contract_v1",
        "generated_at": created_at.isoformat(),
        "is_placeholder": True,
        "config": config,
        "artifacts": {
            "preview_image": job_public_path(job_id, "preview.jpg"),
            "geodata_geojson": job_public_path(job_id, "geodata.geojson"),
            "metadata_json": job_public_path(job_id, "metadata.json"),
        },
    }
    geodata_path.write_text(json.dumps(geodata, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")


def create_video_job(
    db: Session,
    *,
    app_data_root: Path,
    user_id: int,
    property_id: int | None,
    filename: str,
    mode: str,
    config: dict[str, Any],
) -> VideoJob:
    job_id = uuid4().hex
    created_at = _utc_now()
    result_frames = _placeholder_result_frames(job_id)
    _write_placeholder_artifacts(
        app_data_root=app_data_root,
        job_id=job_id,
        filename=filename,
        mode=mode,
        config=config,
        created_at=created_at,
    )

    job = VideoJob(
        id=job_id,
        user_id=user_id,
        property_id=property_id,
        filename=filename,
        mode=mode,
        status="done",
        message="Videojobb registrert med kontrakt-v1 placeholder-resultat.",
        config_json=json.dumps(config, ensure_ascii=False),
        result_frames_json=json.dumps(result_frames, ensure_ascii=False),
        created_at=created_at,
        updated_at=created_at,
    )
    db.add(job)
    db.commit()
    return get_video_job(db, job_id)


def get_video_job(db: Session, job_id: str) -> VideoJob | None:
    return db.execute(
        select(VideoJob)
        .options(joinedload(VideoJob.review))
        .where(VideoJob.id == job_id)
    ).scalar_one_or_none()


def save_video_job_review(
    db: Session,
    *,
    job_id: str,
    created_at: datetime | None,
    mode: str | None,
    review_state: str,
    placement: dict[str, float] | None,
) -> VideoJobReview | None:
    job = get_video_job(db, job_id)
    if job is None:
        return None

    review = job.review
    placement_json = json.dumps(placement, ensure_ascii=False) if placement is not None else None
    if review is None:
        review = VideoJobReview(
            job_id=job_id,
            created_at=created_at,
            mode=mode,
            review_state=review_state,
            placement_json=placement_json,
            reviewed_at=_utc_now(),
        )
        db.add(review)
    else:
        review.created_at = created_at
        review.mode = mode
        review.review_state = review_state
        review.placement_json = placement_json
        review.reviewed_at = _utc_now()

    job.updated_at = review.reviewed_at
    db.commit()
    db.refresh(review)
    return review
