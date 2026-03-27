from __future__ import annotations

import hashlib
import json
import math
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


def _point_distance_m(a: list[float], b: list[float]) -> float:
    lng1, lat1 = a
    lng2, lat2 = b
    avg_lat_rad = math.radians((lat1 + lat2) / 2.0)
    dx = (lng2 - lng1) * 111_320.0 * math.cos(avg_lat_rad)
    dy = (lat2 - lat1) * 110_540.0
    return math.hypot(dx, dy)


def _line_distance_m(coordinates: list[list[float]]) -> float:
    if len(coordinates) < 2:
        return 0.0
    return sum(_point_distance_m(start, end) for start, end in zip(coordinates, coordinates[1:]))


def _interpolate_point(
    coordinates: list[list[float]],
    cumulative_distances: list[float],
    target_distance_m: float,
) -> list[float]:
    if not coordinates:
        return [0.0, 0.0]
    if len(coordinates) == 1 or target_distance_m <= 0:
        return coordinates[0]
    if target_distance_m >= cumulative_distances[-1]:
        return coordinates[-1]

    for index in range(1, len(cumulative_distances)):
        end_distance = cumulative_distances[index]
        if target_distance_m > end_distance:
            continue
        start_distance = cumulative_distances[index - 1]
        segment_length = max(end_distance - start_distance, 1e-9)
        ratio = (target_distance_m - start_distance) / segment_length
        start_point = coordinates[index - 1]
        end_point = coordinates[index]
        lng = start_point[0] + ((end_point[0] - start_point[0]) * ratio)
        lat = start_point[1] + ((end_point[1] - start_point[1]) * ratio)
        return [round(lng, 6), round(lat, 6)]
    return coordinates[-1]


def _normalize_route_coordinates(config: dict[str, Any], fallback_seed: str) -> list[list[float]]:
    raw_points = config.get("route_points")
    if not isinstance(raw_points, list) or len(raw_points) < 2:
        return _job_coordinates(fallback_seed)

    coordinates: list[list[float]] = []
    for point in raw_points:
        if not isinstance(point, dict):
            continue
        try:
            lat = float(point["lat"])
            lng = float(point["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        coordinates.append([round(lng, 6), round(lat, 6)])

    return coordinates if len(coordinates) >= 2 else _job_coordinates(fallback_seed)


def _coerce_positive_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _coerce_positive_int(value: Any, default: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def _frame_artifact_name(frame_index: int) -> str:
    return f"frame-{frame_index:04d}.jpg"


def _write_preview(path: Path, label: str, *, selected_frame_count: int, route_distance_m: float) -> None:
    image = Image.new("RGB", (1280, 720), color=(36, 68, 102))
    draw = ImageDraw.Draw(image)
    draw.rectangle((50, 50, 1230, 670), outline=(225, 232, 240), width=6)
    draw.text((90, 100), "Flyvendebonder videojobb", fill=(245, 248, 252))
    draw.text((90, 160), label, fill=(245, 248, 252))
    draw.text((90, 220), f"Frames valgt: {selected_frame_count}", fill=(214, 224, 234))
    draw.text((90, 280), f"Rutelengde: {round(route_distance_m, 1)} m", fill=(214, 224, 234))
    image.save(path, format="JPEG", quality=82)


def _write_frame_preview(path: Path, *, label: str, selection_index: int, frame_index: int, timestamp_ms: int) -> None:
    image = Image.new("RGB", (960, 540), color=(44, 84, 120))
    draw = ImageDraw.Draw(image)
    draw.rectangle((36, 36, 924, 504), outline=(225, 232, 240), width=5)
    draw.text((72, 82), label, fill=(245, 248, 252))
    draw.text((72, 148), f"Steg {selection_index + 1}", fill=(245, 248, 252))
    draw.text((72, 214), f"Frame {frame_index}", fill=(214, 224, 234))
    draw.text((72, 280), f"Tid {timestamp_ms} ms", fill=(214, 224, 234))
    image.save(path, format="JPEG", quality=82)


def _build_result_frames(*, job_id: str, filename: str, mode: str, config: dict[str, Any]) -> dict[str, Any]:
    fps = _coerce_positive_int(config.get("fps"), 2)
    duration_seconds = _coerce_positive_float(config.get("duration_seconds"), 45.0)
    interval_seconds = _coerce_positive_float(config.get("interval_seconds"), 4.0)
    coordinates = _normalize_route_coordinates(config, f"{filename}:{job_id}:{mode}")
    route_distance_m = round(_line_distance_m(coordinates), 1)

    target_step_distance = _coerce_positive_float(config.get("step_distance_m"), 0.0)
    if target_step_distance <= 0:
        target_step_distance = interval_seconds * max(route_distance_m / max(duration_seconds, 1.0), 1.0)
    target_step_distance = max(target_step_distance, 1.0)

    frame_count = max(_coerce_positive_int(config.get("frame_count"), int(round(duration_seconds * fps))), 2)
    selected_frame_count = max(2, int(math.floor(route_distance_m / target_step_distance)) + 1)
    selected_frame_count = min(selected_frame_count, frame_count)

    cumulative_distances = [0.0]
    for start_point, end_point in zip(coordinates, coordinates[1:]):
        cumulative_distances.append(cumulative_distances[-1] + _point_distance_m(start_point, end_point))

    route_duration_ms = max(int(round(duration_seconds * 1000)), 1)
    step_distance_m = round(route_distance_m / max(selected_frame_count - 1, 1), 1) if selected_frame_count > 1 else route_distance_m
    frame_stride = max(1, int(round((frame_count - 1) / max(selected_frame_count - 1, 1))))

    sample_frames: list[dict[str, Any]] = []
    selected_points: list[dict[str, Any]] = []
    for selection_index in range(selected_frame_count):
        frame_index = min(frame_count - 1, selection_index * frame_stride)
        timestamp_ms = min(route_duration_ms, int(round((frame_index / max(frame_count - 1, 1)) * route_duration_ms)))
        distance_m = min(route_distance_m, round(selection_index * step_distance_m, 1))
        coordinate = _interpolate_point(coordinates, cumulative_distances, distance_m)
        frame_payload = {
            "index": frame_index,
            "timestamp_ms": timestamp_ms,
            "image_url": job_public_path(job_id, _frame_artifact_name(frame_index)),
        }
        sample_frames.append(frame_payload)
        selected_points.append(
            {
                "type": "Feature",
                "properties": {
                    "job_id": job_id,
                    "selection_index": selection_index,
                    "frame_index": frame_index,
                    "timestamp_ms": timestamp_ms,
                    "distance_m": distance_m,
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": coordinate,
                },
            }
        )

    return {
        "frame_count": frame_count,
        "fps": fps,
        "selected_frame_count": selected_frame_count,
        "route_distance_m": route_distance_m,
        "step_distance_m": step_distance_m,
        "sample_frames": sample_frames,
        "archive_url": None,
        "route_points": coordinates,
        "selected_points_geojson": {
            "type": "FeatureCollection",
            "features": selected_points,
        },
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

    result_frames = _build_result_frames(job_id=job_id, filename=filename, mode=mode, config=config)
    coordinates = result_frames["route_points"]
    _write_preview(
        preview_path,
        filename,
        selected_frame_count=result_frames["selected_frame_count"],
        route_distance_m=result_frames["route_distance_m"],
    )
    for selection_index, frame in enumerate(result_frames["sample_frames"]):
        _write_frame_preview(
            path / _frame_artifact_name(frame["index"]),
            label=filename,
            selection_index=selection_index,
            frame_index=frame["index"],
            timestamp_ms=frame["timestamp_ms"],
        )

    geodata = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {
                    "job_id": job_id,
                    "mode": mode,
                    "source_filename": filename,
                    "route_distance_m": result_frames["route_distance_m"],
                },
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
            }
        ]
        + result_frames["selected_points_geojson"]["features"],
    }
    metadata = {
        "job_id": job_id,
        "mode": mode,
        "source_filename": filename,
        "provider": "video_contract_v2",
        "generated_at": created_at.isoformat(),
        "is_placeholder": False,
        "config": config,
        "result_frames": {
            key: value
            for key, value in result_frames.items()
            if key not in {"route_points", "selected_points_geojson"}
        },
        "artifacts": {
            "preview_image": job_public_path(job_id, "preview.jpg"),
            "geodata_geojson": job_public_path(job_id, "geodata.geojson"),
            "metadata_json": job_public_path(job_id, "metadata.json"),
            "sample_frames": result_frames["sample_frames"],
        },
    }
    geodata_path.write_text(json.dumps(geodata, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return result_frames


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
    result_frames = _write_placeholder_artifacts(
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
        message="Videojobb registrert med deterministisk frames-kontrakt.",
        config_json=json.dumps(config, ensure_ascii=False),
        result_frames_json=json.dumps(
            {key: value for key, value in result_frames.items() if key not in {"route_points", "selected_points_geojson"}},
            ensure_ascii=False,
        ),
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


def list_video_jobs(
    db: Session,
    *,
    user_id: int,
    limit: int = 20,
    mode: str | None = None,
    status: str | None = None,
) -> list[VideoJob]:
    query = (
        select(VideoJob)
        .options(joinedload(VideoJob.review))
        .where(VideoJob.user_id == user_id)
        .order_by(VideoJob.created_at.desc(), VideoJob.id.desc())
        .limit(limit)
    )
    if mode is not None:
        query = query.where(VideoJob.mode == mode)
    if status is not None:
        query = query.where(VideoJob.status == status)
    return list(db.execute(query).unique().scalars().all())


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
