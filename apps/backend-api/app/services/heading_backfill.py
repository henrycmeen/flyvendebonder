from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Photo
from .tag_utils import parse_tag_groups, serialize_tag_groups, set_meta_value, set_quality_flag, split_tags


@dataclass(frozen=True)
class TrackPhotoPoint:
    id: str
    captured_at: datetime
    captured_date: date
    lat: float
    lng: float


def bearing_between_points(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
) -> float | None:
    lat1 = math.radians(from_lat)
    lat2 = math.radians(to_lat)
    delta_lng = math.radians(to_lng - from_lng)

    y = math.sin(delta_lng) * math.cos(lat2)
    x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(delta_lng)
    if not math.isfinite(x) or not math.isfinite(y) or (abs(x) < 1e-12 and abs(y) < 1e-12):
      return None

    bearing = (math.degrees(math.atan2(y, x)) + 360.0) % 360.0
    return bearing if math.isfinite(bearing) else None


def distance_between_points_m(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
) -> float:
    east_m = (to_lng - from_lng) * max(1.0, 111_320.0 * math.cos(math.radians(from_lat)))
    north_m = (to_lat - from_lat) * 111_320.0
    return math.sqrt((east_m * east_m) + (north_m * north_m))


def infer_heading_from_neighbors(
    previous_point: TrackPhotoPoint | None,
    current_point: TrackPhotoPoint,
    next_point: TrackPhotoPoint | None,
    *,
    min_distance_m: float = 8.0,
    max_gap_seconds: float = 30 * 60,
) -> float | None:
    def gap_seconds(left: TrackPhotoPoint, right: TrackPhotoPoint) -> float:
        return abs((right.captured_at - left.captured_at).total_seconds())

    def valid_pair(left: TrackPhotoPoint, right: TrackPhotoPoint) -> float | None:
        if left.captured_date != right.captured_date:
            return None
        if gap_seconds(left, right) > max_gap_seconds:
            return None
        if distance_between_points_m(left.lat, left.lng, right.lat, right.lng) < min_distance_m:
            return None
        return bearing_between_points(left.lat, left.lng, right.lat, right.lng)

    if previous_point and next_point:
        smoothed = valid_pair(previous_point, next_point)
        if smoothed is not None:
            return smoothed

    if previous_point:
        backward = valid_pair(previous_point, current_point)
        if backward is not None:
            return backward

    if next_point:
        forward = valid_pair(current_point, next_point)
        if forward is not None:
            return forward

    return None


def infer_missing_headings_for_user(
    db: Session,
    user_id: int,
    *,
    min_distance_m: float = 8.0,
    max_gap_seconds: float = 30 * 60,
    commit: bool = False,
) -> dict[str, int]:
    photos = db.execute(
        select(Photo)
        .where(Photo.user_id == user_id)
        .order_by(Photo.captured_date.asc(), Photo.captured_at.asc(), Photo.id.asc())
    ).scalars().all()

    updated = 0
    skipped_has_heading = 0
    skipped_no_estimate = 0

    grouped: dict[date, list[Photo]] = {}
    for photo in photos:
        grouped.setdefault(photo.captured_date, []).append(photo)

    for day_photos in grouped.values():
        for index, photo in enumerate(day_photos):
            if photo.heading_deg is not None and math.isfinite(photo.heading_deg):
                skipped_has_heading += 1
                continue

            current = TrackPhotoPoint(
                id=photo.id,
                captured_at=photo.captured_at,
                captured_date=photo.captured_date,
                lat=photo.lat,
                lng=photo.lng,
            )
            previous_photo = day_photos[index - 1] if index > 0 else None
            next_photo = day_photos[index + 1] if index + 1 < len(day_photos) else None

            previous_point = (
                TrackPhotoPoint(
                    id=previous_photo.id,
                    captured_at=previous_photo.captured_at,
                    captured_date=previous_photo.captured_date,
                    lat=previous_photo.lat,
                    lng=previous_photo.lng,
                )
                if previous_photo
                else None
            )
            next_point = (
                TrackPhotoPoint(
                    id=next_photo.id,
                    captured_at=next_photo.captured_at,
                    captured_date=next_photo.captured_date,
                    lat=next_photo.lat,
                    lng=next_photo.lng,
                )
                if next_photo
                else None
            )

            heading = infer_heading_from_neighbors(
                previous_point,
                current,
                next_point,
                min_distance_m=min_distance_m,
                max_gap_seconds=max_gap_seconds,
            )
            if heading is None:
                skipped_no_estimate += 1
                continue

            photo.heading_deg = round(heading, 2)

            user_tags, system_tags = parse_tag_groups(photo.tags_json)
            merged_tags = [*user_tags, *system_tags]
            merged_tags = set_meta_value(merged_tags, "meta:heading_source", "inferred_from_sequence")
            merged_tags = set_meta_value(merged_tags, "meta:heading_source_detail", "track_neighbors")
            merged_tags = set_meta_value(merged_tags, "meta:heading_source_candidates", f"inferred_heading={photo.heading_deg:.2f}")
            merged_tags = set_quality_flag(merged_tags, "qc:missing_heading", None)
            normalized_user_tags, normalized_system_tags = split_tags(merged_tags)
            photo.tags_json = serialize_tag_groups(normalized_user_tags, normalized_system_tags)

            updated += 1

    if commit:
        db.commit()
    else:
        db.rollback()

    return {
        "total": len(photos),
        "updated": updated,
        "skipped_has_heading": skipped_has_heading,
        "skipped_no_estimate": skipped_no_estimate,
    }


__all__ = [
    "TrackPhotoPoint",
    "bearing_between_points",
    "distance_between_points_m",
    "infer_heading_from_neighbors",
    "infer_missing_headings_for_user",
]
