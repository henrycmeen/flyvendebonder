from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal


GeometryMethod = Literal["point", "estimated", "manual"]
GeometryPitch = float
GeometryYaw = float


@dataclass
class GeometryResult:
    lat: float
    lng: float
    geometry_method: GeometryMethod
    confidence: float
    source_altitude_m: float = 0.0
    source_pitch_deg: float = 0.0
    source_yaw_deg: float = 0.0
    forward_distance_m: float | None = None


def _normalize_yaw_deg(value: float) -> float:
    normalized = float(value) % 360.0
    return normalized + 360.0 if normalized < 0 else normalized


def _normalize_pitch_deg(value: float) -> GeometryPitch:
    pitch = float(value)
    return max(-89.9, min(89.9, pitch))


def _choose_pitch_component(value: float | None) -> float | None:
    if value is None:
        return None
    normalized = _normalize_pitch_deg(float(value))
    return None if not math.isfinite(normalized) else normalized


def _choose_yaw_component(value: float | None) -> float | None:
    if value is None:
        return None
    normalized = _normalize_yaw_deg(float(value))
    return None if not math.isfinite(normalized) else normalized


def _meters_per_degree_latitude() -> float:
    return 111_320.0


def _meters_per_degree_longitude(latitude: float) -> float:
    return max(1.0, 111_320.0 * math.cos(math.radians(latitude)))


def choose_geometry(
    source_lat: float,
    source_lng: float,
    altitude_m: float | None,
    pitch_deg: float | None,
    yaw_deg: float | None,
) -> GeometryResult:
    if altitude_m is None or pitch_deg is None or yaw_deg is None:
        return GeometryResult(
            lat=source_lat,
            lng=source_lng,
            geometry_method="point",
            confidence=0.6,
            source_altitude_m=float(altitude_m) if altitude_m is not None else 0.0,
            source_pitch_deg=float(pitch_deg) if pitch_deg is not None else 0.0,
            source_yaw_deg=float(yaw_deg) if yaw_deg is not None else 0.0,
        )

    pitch = _choose_pitch_component(pitch_deg)
    yaw = _choose_yaw_component(yaw_deg)
    if pitch is None or yaw is None:
        return GeometryResult(
            lat=source_lat,
            lng=source_lng,
            geometry_method="point",
            confidence=0.6,
            source_altitude_m=float(altitude_m),
            source_pitch_deg=float(pitch_deg),
            source_yaw_deg=float(yaw_deg),
        )

    pitch_abs = abs(pitch)
    if pitch_abs <= 1.0:
        return GeometryResult(lat=source_lat, lng=source_lng, geometry_method="point", confidence=0.6)

    altitude = abs(float(altitude_m))
    if altitude <= 0:
        return GeometryResult(
            lat=source_lat,
            lng=source_lng,
            geometry_method="point",
            confidence=0.6,
            source_altitude_m=0.0,
            source_pitch_deg=float(pitch),
            source_yaw_deg=float(yaw),
        )

    # For gimbal-pitch i DJI metadata er 0 typisk horisont og -90 rett ned.
    # Vi estimerer derfor bakkenedslag med: d = h / tan(|pitch|).
    # Nesten rett ned (|pitch| >= ~89) skal gi svært kort avstand.
    if pitch_abs >= 89.0:
        return GeometryResult(
            lat=source_lat,
            lng=source_lng,
            geometry_method="estimated",
            confidence=0.92,
            source_altitude_m=altitude,
            source_pitch_deg=float(pitch),
            source_yaw_deg=float(yaw),
            forward_distance_m=0.0,
        )

    tan_pitch = math.tan(math.radians(pitch_abs))
    if not math.isfinite(tan_pitch) or tan_pitch <= 0:
        return GeometryResult(lat=source_lat, lng=source_lng, geometry_method="point", confidence=0.6)

    forward_distance = altitude / tan_pitch
    if not math.isfinite(forward_distance) or forward_distance <= 0:
        return GeometryResult(lat=source_lat, lng=source_lng, geometry_method="point", confidence=0.6)

    # Beskyttelse mot metadata-outliers som ellers kan gi kilometer-offset.
    if forward_distance > 4_000:
        return GeometryResult(
            lat=source_lat,
            lng=source_lng,
            geometry_method="point",
            confidence=0.55,
            source_altitude_m=altitude,
            source_pitch_deg=float(pitch),
            source_yaw_deg=float(yaw),
            forward_distance_m=forward_distance,
        )

    yaw_rad = math.radians(yaw)
    d_lat = forward_distance * math.cos(yaw_rad)
    d_lng = forward_distance * math.sin(yaw_rad)

    estimated_lat = source_lat + (d_lat / _meters_per_degree_latitude())
    estimated_lng = source_lng + (d_lng / _meters_per_degree_longitude(source_lat))

    return GeometryResult(
        lat=estimated_lat,
        lng=estimated_lng,
        geometry_method="estimated",
        confidence=0.8 if pitch_abs >= 25 else 0.72,
        source_altitude_m=altitude,
        source_pitch_deg=float(pitch),
        source_yaw_deg=float(yaw),
        forward_distance_m=forward_distance,
    )
