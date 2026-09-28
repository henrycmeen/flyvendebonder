from __future__ import annotations

import math

ANALYSIS_STRATEGY = "cross_5"
ANALYSIS_RADIUS_MIN_M = 1.5
ANALYSIS_RADIUS_MAX_M = 5.0
ANALYSIS_RADIUS_DEFAULT_M = 2.8


def meters_per_degree_latitude() -> float:
    return 111_320.0


def meters_per_degree_longitude(latitude: float) -> float:
    return max(1.0, 111_320.0 * math.cos(math.radians(latitude)))


def degree_offset_from_offsets(latitude: float, north_m: float, east_m: float) -> tuple[float, float]:
    d_lat = north_m / meters_per_degree_latitude()
    d_lng = east_m / meters_per_degree_longitude(latitude)
    return d_lat, d_lng


def rotate_vector(east_m: float, north_m: float, heading_deg: float | None) -> tuple[float, float]:
    # Compass headings turn clockwise from north. A missing heading leaves the
    # symmetric sampling grid aligned with the map; it is not a measured yaw.
    angle = math.radians((heading_deg or 0.0) % 360.0)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    east_rot = east_m * cos_a + north_m * sin_a
    north_rot = -east_m * sin_a + north_m * cos_a
    return east_rot, north_rot


def build_footprint_polygon(
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
        east, north = rotate_vector(east_local, north_local, heading_deg)
        d_lat, d_lng = degree_offset_from_offsets(center_lat, north, east)
        coordinates.append([center_lng + d_lng, center_lat + d_lat])

    return {"type": "Polygon", "coordinates": [coordinates]}


def derive_analysis_radius(location_uncertainty_m: float | None, forward_distance_m: float | None) -> float:
    radius = ANALYSIS_RADIUS_DEFAULT_M

    if forward_distance_m is not None and forward_distance_m > 0:
        radius = max(radius, min(ANALYSIS_RADIUS_MAX_M, forward_distance_m * 0.08))
    if location_uncertainty_m is not None:
        radius = max(radius, min(ANALYSIS_RADIUS_MAX_M, location_uncertainty_m * 0.4))

    return round(max(ANALYSIS_RADIUS_MIN_M, min(ANALYSIS_RADIUS_MAX_M, radius)), 2)


def build_analysis_zone(
    *,
    center_lat: float,
    center_lng: float,
    heading_deg: float | None,
    forward_distance_m: float | None,
    location_uncertainty_m: float,
) -> dict:
    radius_m = derive_analysis_radius(location_uncertainty_m, forward_distance_m)

    sample_offsets = [
        (0.0, 0.0),
        (0.0, radius_m),
        (0.0, -radius_m),
        (radius_m, 0.0),
        (-radius_m, 0.0),
    ]

    sample_points: list[dict[str, float]] = []
    for east_local, north_local in sample_offsets:
        east, north = rotate_vector(east_local, north_local, heading_deg)
        d_lat, d_lng = degree_offset_from_offsets(center_lat, north, east)
        sample_points.append({"lat": center_lat + d_lat, "lng": center_lng + d_lng})

    return {
        "center_point": {"lat": center_lat, "lng": center_lng},
        "sample_points": sample_points,
        "footprint_polygon": build_footprint_polygon(center_lat, center_lng, heading_deg, radius_m),
        "sampling_strategy": {"type": ANALYSIS_STRATEGY, "radius_m": radius_m},
        "uncertainty_radius_m": location_uncertainty_m,
        "analysis_area_m": round(math.pi * (radius_m ** 2), 2),
    }


def derive_quality_confidence(
    *,
    altitude_m: float | None,
    heading_deg: float | None,
    pitch_deg: float | None,
    quality_flags: list[str],
    geometry_confidence: float,
) -> tuple[float, list[str]]:
    score = geometry_confidence
    reasons: list[str] = []

    if altitude_m is None:
        reasons.append("missing_altitude")
        score -= 0.12
    else:
        reasons.append("altitude_present")

    if heading_deg is None:
        reasons.append("missing_heading")
        score -= 0.15
    else:
        reasons.append("heading_present")

    if pitch_deg is None:
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

    if "qc:coverage_front_gap" in quality_flags:
        reasons.append("coverage_front_gap")
        score -= 0.08

    if "qc:coverage_side_gap" in quality_flags:
        reasons.append("coverage_side_gap")
        score -= 0.08

    if quality_flags:
        reasons.append("metadata_flags_present")

    return round(max(0.0, min(1.0, score)), 2), reasons


def derive_location_uncertainty(
    *,
    altitude_m: float | None,
    pitch_deg: float | None,
    quality_flags: list[str],
    geometry_confidence: float,
    view_mode: str,
) -> float:
    if view_mode == "manual":
        uncertainty = 2.5
        if "qc:missing_gps" in quality_flags:
            uncertainty += 2.0
        return round(uncertainty, 2)

    if altitude_m is None or pitch_deg is None:
        return 30.0 if altitude_m is None else 22.0

    if view_mode == "estimated":
        altitude = max(1.0, abs(altitude_m))
        pitch_abs = abs(pitch_deg or 0.0)
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


__all__ = [
    "ANALYSIS_STRATEGY",
    "ANALYSIS_RADIUS_MIN_M",
    "ANALYSIS_RADIUS_MAX_M",
    "ANALYSIS_RADIUS_DEFAULT_M",
    "build_analysis_zone",
    "build_footprint_polygon",
    "degree_offset_from_offsets",
    "derive_analysis_radius",
    "derive_location_uncertainty",
    "derive_quality_confidence",
    "meters_per_degree_latitude",
    "meters_per_degree_longitude",
    "rotate_vector",
]
