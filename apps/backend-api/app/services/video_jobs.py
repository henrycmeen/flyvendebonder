from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any
from uuid import uuid4

from PIL import Image, ImageDraw


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _job_dir(app_data_root: Path, job_id: str) -> Path:
    return app_data_root / "video-jobs" / job_id


def _job_public_path(job_id: str, filename: str) -> str:
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


@dataclass(slots=True)
class VideoJobReviewRecord:
    job_id: str
    created_at: datetime | None
    mode: str | None
    review_state: str
    placement: dict[str, float] | None
    reviewed_at: datetime

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "created_at": self.created_at,
            "mode": self.mode,
            "review_state": self.review_state,
            "placement": self.placement,
            "reviewed_at": self.reviewed_at,
        }


@dataclass(slots=True)
class VideoJobRecord:
    job_id: str
    filename: str
    mode: str
    status: str
    created_at: datetime
    updated_at: datetime
    message: str | None
    config: dict[str, Any]
    result_frames: dict[str, Any]
    review: VideoJobReviewRecord | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "job_id": self.job_id,
            "filename": self.filename,
            "mode": self.mode,
            "status": self.status,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "message": self.message,
            "config": self.config,
            "result_frames": self.result_frames,
            "result": self.result_frames,
            "review": self.review.to_dict() if self.review else None,
        }


class VideoJobRegistry:
    def __init__(self) -> None:
        self._lock = Lock()
        self._jobs: dict[str, VideoJobRecord] = {}

    def create_job(
        self,
        *,
        app_data_root: Path,
        filename: str,
        mode: str,
        config: dict[str, Any],
    ) -> VideoJobRecord:
        job_id = uuid4().hex
        created_at = _utc_now()
        job_path = _job_dir(app_data_root, job_id)
        job_path.mkdir(parents=True, exist_ok=True)

        preview_path = job_path / "preview.jpg"
        metadata_path = job_path / "metadata.json"
        geodata_path = job_path / "geodata.geojson"

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
                "preview_image": _job_public_path(job_id, "preview.jpg"),
                "geodata_geojson": _job_public_path(job_id, "geodata.geojson"),
                "metadata_json": _job_public_path(job_id, "metadata.json"),
            },
        }
        geodata_path.write_text(json.dumps(geodata, ensure_ascii=False, indent=2), encoding="utf-8")
        metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")

        preview_url = _job_public_path(job_id, "preview.jpg")
        result_frames = {
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
        record = VideoJobRecord(
            job_id=job_id,
            filename=filename,
            mode=mode,
            status="done",
            created_at=created_at,
            updated_at=created_at,
            message="Videojobb registrert med kontrakt-v1 placeholder-resultat.",
            config=config,
            result_frames=result_frames,
            review=None,
        )
        with self._lock:
            self._jobs[job_id] = record
        return record

    def get_job(self, job_id: str) -> VideoJobRecord | None:
        with self._lock:
            return self._jobs.get(job_id)

    def save_review(
        self,
        *,
        job_id: str,
        created_at: datetime | None,
        mode: str | None,
        review_state: str,
        placement: dict[str, float] | None,
    ) -> VideoJobReviewRecord | None:
        with self._lock:
            record = self._jobs.get(job_id)
            if record is None:
                return None
            review = VideoJobReviewRecord(
                job_id=job_id,
                created_at=created_at,
                mode=mode,
                review_state=review_state,
                placement=placement,
                reviewed_at=_utc_now(),
            )
            record.review = review
            record.updated_at = review.reviewed_at
            return review


video_job_registry = VideoJobRegistry()
