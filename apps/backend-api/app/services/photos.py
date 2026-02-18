from __future__ import annotations

import base64
import json
import logging
import math
from datetime import date, datetime

from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from ..models import Photo, PhotoAsset
from .analysis_enrich import enrich_photo
from .geometry_utils import GeometryMethod, choose_geometry

logger = logging.getLogger(__name__)

_ANALYSIS_STRATEGY = "cross_5"
_ANALYSIS_RADIUS_MIN_M = 1.5
_ANALYSIS_RADIUS_MAX_M = 5.0
_ANALYSIS_RADIUS_DEFAULT_M = 2.8
_COVERAGE_GAP_WARN_THRESHOLD = 0.18


def timeline_dates(db: Session, user_id: int) -> list[dict[str, int | date]]:
    rows = db.execute(
        select(Photo.captured_date, func.count(Photo.id))
        .where(Photo.user_id == user_id)
        .group_by(Photo.captured_date)
        .order_by(Photo.captured_date)
    ).all()

    cumulative = 0
    output: list[dict[str, int | date]] = []
    for captured_date, count in rows:
        cumulative += count
        output.append({"date": captured_date, "count": count, "cumulative_count": cumulative})
    return output


def _choose_asset(assets: list[PhotoAsset], kind: str) -> PhotoAsset | None:
    for asset in assets:
        if asset.kind == kind:
            return asset
    return None


def _parse_tags(photo_tags_json: str | None) -> list[str]:
    try:
        parsed = json.loads(photo_tags_json or "[]")
    except json.JSONDecodeError:
        return []

    return [str(tag) for tag in parsed if isinstance(tag, str) and tag.strip()]


def _extract_quality_flags(tags: list[str]) -> list[str]:
    return sorted({tag for tag in tags if tag.startswith("qc:")})


def _extract_meta_value(tags: list[str], prefix: str) -> str | None:
    normalized_prefix = prefix.rstrip("=") + "="
    for tag in tags:
        if tag.startswith(normalized_prefix):
            return tag[len(normalized_prefix) :].strip()
    return None


def _clamp_unit(value: float) -> float:
    return max(0.0, min(1.0, value))


def _derive_quality_confidence(photo: Photo, quality_flags: list[str], geometry_confidence: float) -> tuple[float, list[str]]:
    reasons: list[str] = []
    score = geometry_confidence

    if photo.altitude_m is None:
        reasons.append("missing_altitude")
        score -= 0.12
    else:
        reasons.append("altitude_present")

    if photo.heading_deg is None:
        reasons.append("missing_heading")
        score -= 0.15
    else:
        reasons.append("heading_present")

    if photo.pitch_deg is None:
        reasons.append("missing_pitch")
        score -= 0.1
    else:
        reasons.append("pitch_present")

    if "qc:missing_gps" in quality_flags:
        reasons.append("gps_issue")
        score -= 0.22
    if "qc:missing_heading" in quality_flags:
        reasons.append("heading_issue")
        score -= 0.18
    if "qc:missing_pitch" in quality_flags:
        reasons.append("pitch_issue")
        score -= 0.12
    if "qc:heading_source_switch" in quality_flags:
        reasons.append("heading_source_switched")
        score -= 0.08
    if "qc:pitch_source_switch" in quality_flags:
        reasons.append("pitch_source_switched")
        score -= 0.06
    if "qc:heading_source_conflict" in quality_flags:
        reasons.append("heading_source_conflict")
        score -= 0.1
    if "qc:pitch_source_conflict" in quality_flags:
        reasons.append("pitch_source_conflict")
        score -= 0.08
    if "qc:pitch_sign_uncertain" in quality_flags:
        reasons.append("pitch_sign_uncertain")
        score -= 0.06
    if "qc:missing_gsd_input" in quality_flags:
        reasons.append("ground_sampling_unavailable")
        score -= 0.08

    if quality_flags:
        reasons.append("metadata_flags_present")

    return _clamp_unit(round(score, 2)), reasons


def _derive_location_uncertainty_m(photo: Photo, quality_flags: list[str], geometry_confidence: float, view_mode: str) -> float:
    if photo.pitch_deg is None or photo.altitude_m is None:
        return 30.0 if photo.altitude_m is None else 22.0

    if view_mode == "estimated":
        altitude = max(1.0, abs(photo.altitude_m))
        pitch_abs = abs(photo.pitch_deg or 0.0)
        uncertainty = max(2.0, altitude / max(15.0, pitch_abs) * 0.9)
        if geometry_confidence < 0.7:
            uncertainty += 6.0
    else:
        uncertainty = 15.0

    if "qc:missing_heading" in quality_flags:
        uncertainty += 5.0
    if "qc:missing_pitch" in quality_flags:
        uncertainty += 4.0
    if "qc:missing_gps" in quality_flags:
        uncertainty += 8.0
    if "qc:heading_source_switch" in quality_flags:
        uncertainty += 2.0
    if "qc:pitch_source_switch" in quality_flags:
        uncertainty += 3.0
    if "qc:heading_source_conflict" in quality_flags:
        uncertainty += 4.0
    if "qc:pitch_source_conflict" in quality_flags:
        uncertainty += 4.0
    if "qc:pitch_sign_uncertain" in quality_flags:
        uncertainty += 2.0

    return round(uncertainty, 2)


def _meters_per_degree_latitude() -> float:
    return 111_320.0


def _meters_per_degree_longitude(latitude: float) -> float:
    return max(1.0, 111_320.0 * math.cos(math.radians(latitude)))


def _degrees_from_offsets(latitude: float, north_m: float, east_m: float) -> tuple[float, float]:
    d_lat = north_m / _meters_per_degree_latitude()
    d_lng = east_m / _meters_per_degree_longitude(latitude)
    return d_lat, d_lng


def _offsets_from_positions(
    from_lat: float,
    from_lng: float,
    to_lat: float,
    to_lng: float,
) -> tuple[float, float]:
    east_m = (to_lng - from_lng) * _meters_per_degree_longitude(from_lat)
    north_m = (to_lat - from_lat) * _meters_per_degree_latitude()
    return east_m, north_m


def _rotate_vector(east_m: float, north_m: float, heading_deg: float | None) -> tuple[float, float]:
    angle = math.radians((heading_deg or 0.0) % 360.0)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)

    # x=øst, y=nord
    east_rot = east_m * cos_a - north_m * sin_a
    north_rot = east_m * sin_a + north_m * cos_a
    return east_rot, north_rot


def _project_forward_side(east_m: float, north_m: float, heading_deg: float | None) -> tuple[float, float]:
    angle = math.radians((heading_deg or 0.0) % 360.0)
    # forward > 0 betyr nærmere det kamera peker.
    forward_m = east_m * math.sin(angle) + north_m * math.cos(angle)
    side_m = east_m * math.cos(angle) - north_m * math.sin(angle)
    return forward_m, side_m


def _coverage_ratio_from_spacing(footprint_width_m: float | None, spacing_m: float | None) -> float | None:
    if spacing_m is None or footprint_width_m is None or footprint_width_m <= 0:
        return None

    if spacing_m <= 0:
        return 1.0

    ratio = 1.0 - spacing_m / footprint_width_m
    return round(max(0.0, min(1.0, ratio)), 3)


def _build_coverage_profile(
    photo: Photo,
    previous_photo: Photo | None,
    next_photo: Photo | None,
) -> dict[str, float | str | None]:
    planned_front = photo.overlap_front
    planned_side = photo.overlap_side
    footprint_w_m = photo.image_footprint_w_m

    view_lat, view_lng, _, _, _ = _derive_camera_view(photo)

    forward_spacings: list[float] = []
    side_spacings: list[float] = []
    for neighbor in (previous_photo, next_photo):
        if neighbor is None:
            continue

        neighbor_view = _derive_camera_view(neighbor)
        if neighbor_view[0] is None or neighbor_view[1] is None:
            continue

        east_m, north_m = _offsets_from_positions(view_lat, view_lng, neighbor_view[0], neighbor_view[1])
        forward_m, side_m = _project_forward_side(east_m, north_m, photo.heading_deg)
        forward_spacings.append(abs(forward_m))
        side_spacings.append(abs(side_m))

    actual_front = _coverage_ratio_from_spacing(
        footprint_w_m,
        min(forward_spacings) if forward_spacings else None,
    )
    actual_side = _coverage_ratio_from_spacing(
        footprint_w_m,
        min(side_spacings) if side_spacings else None,
    )

    front_gap = None
    if planned_front is not None and actual_front is not None:
        front_gap = round(planned_front - actual_front, 3)
    side_gap = None
    if planned_side is not None and actual_side is not None:
        side_gap = round(planned_side - actual_side, 3)

    quality = "unknown"
    if any(v is not None for v in (actual_front, actual_side)):
        flags = []
        if front_gap is not None and front_gap > _COVERAGE_GAP_WARN_THRESHOLD:
            flags.append("front")
        if side_gap is not None and side_gap > _COVERAGE_GAP_WARN_THRESHOLD:
            flags.append("side")
        quality = "warn" if flags else "ok"

    return {
        "planned_front": planned_front,
        "planned_side": planned_side,
        "actual_front": actual_front,
        "actual_side": actual_side,
        "front_gap": front_gap,
        "side_gap": side_gap,
        "neighbor_count": len([item for item in (previous_photo, next_photo) if item is not None]),
        "quality": quality,
    }


def _derive_analysis_radius(location_uncertainty_m: float | None, forward_distance_m: float | None) -> float:
    radius = _ANALYSIS_RADIUS_DEFAULT_M
    if forward_distance_m is not None and forward_distance_m > 0:
        radius = max(radius, min(_ANALYSIS_RADIUS_MAX_M, forward_distance_m * 0.08))
    if location_uncertainty_m is not None:
        radius = max(radius, min(_ANALYSIS_RADIUS_MAX_M, location_uncertainty_m * 0.4))

    return round(max(_ANALYSIS_RADIUS_MIN_M, min(_ANALYSIS_RADIUS_MAX_M, radius)), 2)


def _build_footprint_polygon(
    center_lat: float,
    center_lng: float,
    heading_deg: float | None,
    radius_m: float,
) -> dict:
    local_corners = [
        (-radius_m, -radius_m),
        (radius_m, -radius_m),
        (radius_m, radius_m),
        (-radius_m, radius_m),
        (-radius_m, -radius_m),
    ]

    coordinates: list[list[float]] = []
    for east_local, north_local in local_corners:
        east, north = _rotate_vector(east_local, north_local, heading_deg)
        d_lat, d_lng = _degrees_from_offsets(center_lat, north, east)
        coordinates.append([center_lng + d_lng, center_lat + d_lat])

    return {"type": "Polygon", "coordinates": [coordinates]}


def _build_analysis_zone(
    photo: Photo,
    view_lat: float,
    view_lng: float,
    view_distance_m: float | None,
    location_uncertainty_m: float,
) -> dict:
    radius_m = _derive_analysis_radius(location_uncertainty_m, view_distance_m)

    sample_offsets = [
        (0.0, 0.0),     # sentrum
        (0.0, radius_m),  # fram (heading-nord)
        (0.0, -radius_m), # bak
        (radius_m, 0.0),  # høyre (øst)
        (-radius_m, 0.0), # venstre (vest)
    ]

    sample_points: list[dict[str, float]] = []
    for east_local, north_local in sample_offsets:
        east, north = _rotate_vector(east_local, north_local, photo.heading_deg)
        d_lat, d_lng = _degrees_from_offsets(view_lat, north, east)
        sample_points.append({"lat": view_lat + d_lat, "lng": view_lng + d_lng})

    return {
        "center_point": {"lat": view_lat, "lng": view_lng},
        "sample_points": sample_points,
        "footprint_polygon": _build_footprint_polygon(view_lat, view_lng, photo.heading_deg, radius_m),
        "sampling_strategy": {"type": _ANALYSIS_STRATEGY, "radius_m": radius_m},
        "uncertainty_radius_m": location_uncertainty_m,
        "analysis_area_m": round(math.pi * (radius_m ** 2), 2),
    }


def _base_photo_query(user_id: int, selected_date: date, mode: str):
    query = select(Photo).where(Photo.user_id == user_id)
    if mode == "day":
        query = query.where(Photo.captured_date == selected_date)
    else:
        query = query.where(Photo.captured_date <= selected_date)
    return query


def _derive_camera_view(photo: Photo) -> tuple[float, float, GeometryMethod, float | None, float]:
    if photo.heading_deg is None or photo.pitch_deg is None or photo.altitude_m is None:
        return photo.lat, photo.lng, "point", None, 0.5

    geometry = choose_geometry(
        source_lat=photo.lat,
        source_lng=photo.lng,
        altitude_m=photo.altitude_m,
        pitch_deg=photo.pitch_deg,
        yaw_deg=photo.heading_deg,
    )
    return geometry.lat, geometry.lng, geometry.geometry_method, geometry.forward_distance_m, geometry.confidence


def _serialize_photo(
    photo: Photo,
    previous_photo: Photo | None = None,
    next_photo: Photo | None = None,
) -> dict:
    view_lat, view_lng, view_mode, view_distance_m, view_confidence = _derive_camera_view(photo)
    tags = _parse_tags(photo.tags_json)
    quality_flags = _extract_quality_flags(tags)
    needs_manual_qc = "qc:needs_manual_qc" in quality_flags
    heading_source = _extract_meta_value(tags, "meta:heading_source")
    pitch_source = _extract_meta_value(tags, "meta:pitch_source")
    confidence_score, confidence_reasons = _derive_quality_confidence(photo, quality_flags, view_confidence)
    location_uncertainty_m = _derive_location_uncertainty_m(photo, quality_flags, view_confidence, view_mode)
    analysis_zone = _build_analysis_zone(
        photo,
        view_lat=view_lat,
        view_lng=view_lng,
        view_distance_m=view_distance_m,
        location_uncertainty_m=location_uncertainty_m,
    )
    coverage_profile = _build_coverage_profile(photo, previous_photo, next_photo)

    thumb_asset = _choose_asset(photo.assets, "thumb") or _choose_asset(photo.assets, "web")
    web_asset = _choose_asset(photo.assets, "web") or _choose_asset(photo.assets, "original")

    return {
        "id": photo.id,
        "title": f"Foto {photo.captured_date.isoformat()} · {photo.source_filename}",
        "captured_at": photo.captured_at,
        "captured_date": photo.captured_date,
        "lat": photo.lat,
        "lng": photo.lng,
        "altitude_m": photo.altitude_m,
        "heading_deg": photo.heading_deg,
        "pitch_deg": photo.pitch_deg,
        "gsd_m": photo.gsd_m,
        "image_footprint_w_m": photo.image_footprint_w_m,
        "track_spacing_m": photo.track_spacing_m,
        "overlap_front": photo.overlap_front,
        "overlap_side": photo.overlap_side,
        "oblique_correction_applied": photo.oblique_correction_applied,
        "view_lat": view_lat,
        "view_lng": view_lng,
        "view_confidence": view_confidence,
        "view_distance_m": view_distance_m,
        "view_mode": view_mode,
        "heading_source": heading_source,
        "pitch_source": pitch_source,
        "confidence_score": confidence_score,
        "confidence_reasons": confidence_reasons,
        "location_uncertainty_m": location_uncertainty_m,
        "analysis_zone": analysis_zone,
        "coverage_profile": coverage_profile,
        "tags": tags,
        "caption": photo.notes,
        "thumbnail_url": f"/api/v1/assets/{thumb_asset.path}" if thumb_asset else None,
        "image_url": f"/api/v1/assets/{web_asset.path}" if web_asset else None,
        "needs_manual_qc": needs_manual_qc,
        "quality_flags": quality_flags,
        "analysis": {
            "ar5_class": photo.analysis.ar5_class if photo.analysis else None,
            "soil_class": photo.analysis.soil_class if photo.analysis else None,
            "geometry_method": photo.analysis.geometry_method if photo.analysis else None,
            "confidence": photo.analysis.confidence if photo.analysis else None,
            "approved": photo.analysis.approved if photo.analysis else None,
            "computed_at": photo.analysis.computed_at if photo.analysis else None,
        },
    }


def _encode_cursor(captured_at: datetime, photo_id: str) -> str:
    raw = f"{captured_at.isoformat(timespec='microseconds')}|{photo_id}"
    encoded = base64.urlsafe_b64encode(raw.encode("utf-8")).decode("utf-8")
    return encoded.rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padding = "=" * (-len(cursor) % 4)
        decoded = base64.urlsafe_b64decode(cursor + padding).decode("utf-8")
        captured_at_raw, photo_id = decoded.split("|", 1)
        captured_at = datetime.fromisoformat(captured_at_raw)
        return captured_at, photo_id
    except Exception as exc:  # noqa: BLE001
        raise ValueError("Ugyldig cursor-format") from exc


def load_photos_for_date(
    db: Session, user_id: int, selected_date: date, mode: str, *, include_analysis: bool = False
) -> list[dict]:
    query = _base_photo_query(user_id=user_id, selected_date=selected_date, mode=mode)

    photos = db.execute(
        query.options(selectinload(Photo.assets), selectinload(Photo.analysis))
        .order_by(Photo.captured_at, Photo.id)
    ).scalars().all()

    if include_analysis:
        for photo in photos:
            try:
                enrich_photo(db, photo, force=False)
            except Exception as exc:  # noqa: BLE001
                logger.debug("Analyse feilet under listehenting", extra={"photo_id": photo.id, "error": str(exc)})

    return [
        _serialize_photo(photo, previous_photo=photos[index - 1] if index > 0 else None, next_photo=photos[index + 1] if index + 1 < len(photos) else None)
        for index, photo in enumerate(photos)
    ]


def load_photos_page(
    db: Session,
    *,
    user_id: int,
    selected_date: date,
    mode: str,
    limit: int,
    cursor: str | None,
    sort: str,
    include_analysis: bool = False,
) -> tuple[list[dict], str | None]:
    query = _base_photo_query(user_id=user_id, selected_date=selected_date, mode=mode)

    order_captured = asc(Photo.captured_at) if sort == "asc" else desc(Photo.captured_at)
    order_id = asc(Photo.id) if sort == "asc" else desc(Photo.id)

    if cursor:
        cursor_time, cursor_id = _decode_cursor(cursor)
        if sort == "asc":
            query = query.where(
                or_(
                    Photo.captured_at > cursor_time,
                    and_(Photo.captured_at == cursor_time, Photo.id > cursor_id),
                )
            )
        else:
            query = query.where(
                or_(
                    Photo.captured_at < cursor_time,
                    and_(Photo.captured_at == cursor_time, Photo.id < cursor_id),
                )
            )

    rows = db.execute(
        query.options(selectinload(Photo.assets), selectinload(Photo.analysis))
        .order_by(order_captured, order_id)
        .limit(limit + 1)
    ).scalars().all()

    if include_analysis:
        for photo in rows:
            try:
                enrich_photo(db, photo, force=False)
            except Exception as exc:  # noqa: BLE001
                logger.debug("Analyse feilet under paginering", extra={"photo_id": photo.id, "error": str(exc)})

    has_next = len(rows) > limit
    page_rows = rows[:limit]
    next_cursor = _encode_cursor(page_rows[-1].captured_at, page_rows[-1].id) if has_next and page_rows else None

    return [
        _serialize_photo(photo, previous_photo=page_rows[index - 1] if index > 0 else None, next_photo=page_rows[index + 1] if index + 1 < len(page_rows) else None)
        for index, photo in enumerate(page_rows)
    ], next_cursor
