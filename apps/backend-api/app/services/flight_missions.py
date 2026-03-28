from __future__ import annotations

import io
import json
import math
import zipfile
from datetime import datetime
from typing import Any

from shapely import affinity
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Point, Polygon
from shapely.ops import unary_union

from ..models import Property
from .field_plots import normalize_polygon_coordinates, polygon_area_m2
from .planning import planning_duration_status, suggest_spacing_for_profile
from .quality_metrics import meters_per_degree_latitude, meters_per_degree_longitude

RECOMMENDED_ALTITUDE_RANGE_M = (20.0, 120.0)
RECOMMENDED_LINE_SPACING_RANGE_M = (8.0, 35.0)
RECOMMENDED_WAYPOINT_SPACING_RANGE_M = (8.0, 35.0)
MIN_FIELD_AREA_FOR_ROUTE_M2 = 250.0
EXPORT_BUNDLE_FORMAT = "flyvendebonder.flight-mission-bundle.v1"


def build_flight_mission_payload(
    *,
    property_obj: Property,
    fields: list[dict[str, Any]],
    name: str | None,
    parameters: dict[str, Any],
    planning_unit_ids: list[int] | None = None,
    drone_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_parameters = _normalize_parameters(parameters)
    recommended_spacing = suggest_spacing_for_profile(drone_profile, altitude_m=normalized_parameters["altitude_m"])
    warnings = _parameter_warnings(normalized_parameters, recommended_spacing=recommended_spacing)

    field_snapshots: list[dict[str, Any]] = []
    route_features: list[dict[str, Any]] = []
    total_waypoints = 0
    total_distance_m = 0.0
    previous_route_point: list[float] | None = None

    if normalized_parameters["launch_point"] is not None:
        launch_point = normalized_parameters["launch_point"]
        route_features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "launch_point",
                    "name": "Startpunkt",
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [launch_point["lng"], launch_point["lat"]],
                },
            }
        )
        previous_route_point = [launch_point["lng"], launch_point["lat"]]

    if normalized_parameters["no_go_buffers"]:
        for index, no_go_buffer in enumerate(normalized_parameters["no_go_buffers"], start=1):
            route_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "kind": "no_go_buffer",
                        "name": no_go_buffer["name"] or f"No-go {index}",
                        "radius_m": no_go_buffer["radius_m"],
                    },
                    "geometry": _buffer_feature_geometry(no_go_buffer["center"], no_go_buffer["radius_m"]),
                }
            )

    for field in fields:
        geometry = field["geometry"]
        coordinates = normalize_polygon_coordinates(geometry["coordinates"])
        area_m2 = round(field.get("area_m2") or polygon_area_m2(coordinates), 2)
        field_name = str(field.get("name") or f"Jord {field.get('field_id', '?')}").strip()
        field_id = int(field["field_id"])
        planning_unit_id = field.get("planning_unit_id")

        snapshot = {
            "field_id": field_id,
            "planning_unit_id": planning_unit_id,
            "name": field_name,
            "area_m2": area_m2,
            "area_ha": round(area_m2 / 10_000, 4) if area_m2 is not None else None,
            "geometry": {"type": "Polygon", "coordinates": coordinates},
        }
        field_snapshots.append(snapshot)

        if len(coordinates) > 1:
            warnings.append(
                _warning(
                    "holes_not_supported",
                    "warning",
                    "Oppdragsgeneratoren bruker bare yttergrensen i første versjon. Hull må kontrolleres manuelt.",
                    field_id=field_id,
                )
            )

        if area_m2 < MIN_FIELD_AREA_FOR_ROUTE_M2:
            warnings.append(
                _warning(
                    "field_too_small",
                    "warning",
                    "Jordet er svært lite. Eksporten bør kontrolleres manuelt før flyging.",
                    field_id=field_id,
                )
            )

        route_result = _build_field_route(
            coordinates[0],
            route_angle_deg=normalized_parameters["route_angle_deg"],
            line_spacing_m=normalized_parameters["line_spacing_m"],
            waypoint_spacing_m=normalized_parameters["waypoint_spacing_m"],
            no_go_buffers=normalized_parameters["no_go_buffers"],
        )
        route_points = route_result["points"]
        if len(route_points) < 2:
            warnings.append(
                _warning(
                    "route_generation_failed",
                    "warning",
                    "Klarte ikke å lage en brukbar sweep-rute for jordet. Finjuster geometri eller parametre.",
                    field_id=field_id,
                )
            )
            continue

        if route_result["buffer_count"] > 0:
            warnings.append(
                _warning(
                    "no_go_buffers_applied",
                    "info",
                    f"{route_result['buffer_count']} hinderbuffer(e) ble trukket ut av rutegrunnlaget.",
                    field_id=field_id,
                )
            )

        total_waypoints += len(route_points)
        if previous_route_point and previous_route_point != route_points[0]:
            transit_coordinates = [previous_route_point, route_points[0]]
            total_distance_m += _polyline_distance_m(transit_coordinates)
            route_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "field_id": field_id,
                        "planning_unit_id": planning_unit_id,
                        "field_name": field_name,
                        "kind": "transit",
                    },
                    "geometry": {"type": "LineString", "coordinates": transit_coordinates},
                }
            )
        total_distance_m += _polyline_distance_m(route_points)
        route_features.append(
            {
                "type": "Feature",
                "properties": {
                    "field_id": field_id,
                    "planning_unit_id": planning_unit_id,
                    "field_name": field_name,
                    "kind": "route",
                    "altitude_m": normalized_parameters["altitude_m"],
                    "line_spacing_m": normalized_parameters["line_spacing_m"],
                    "waypoint_spacing_m": normalized_parameters["waypoint_spacing_m"],
                    "route_angle_deg": normalized_parameters["route_angle_deg"],
                    "waypoint_count": len(route_points),
                },
                "geometry": {"type": "LineString", "coordinates": route_points},
            }
        )
        for index, point in enumerate(route_points, start=1):
            route_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "field_id": field_id,
                        "planning_unit_id": planning_unit_id,
                        "field_name": field_name,
                        "kind": "waypoint",
                        "sequence": index,
                        "altitude_m": normalized_parameters["altitude_m"],
                    },
                    "geometry": {"type": "Point", "coordinates": point},
                }
            )
        previous_route_point = route_points[-1]

    if normalized_parameters["landing_point"] is not None:
        landing_point = normalized_parameters["landing_point"]
        landing_coordinates = [landing_point["lng"], landing_point["lat"]]
        if previous_route_point and previous_route_point != landing_coordinates:
            total_distance_m += _polyline_distance_m([previous_route_point, landing_coordinates])
            route_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "kind": "transit",
                        "name": "Retur til landing",
                    },
                    "geometry": {"type": "LineString", "coordinates": [previous_route_point, landing_coordinates]},
                }
            )
        route_features.append(
            {
                "type": "Feature",
                "properties": {
                    "kind": "landing_point",
                    "name": "Landingspunkt",
                },
                "geometry": {"type": "Point", "coordinates": landing_coordinates},
            }
        )

    route_geojson = {"type": "FeatureCollection", "features": route_features}
    generated_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    mission_name = (name or f"Oppdrag {property_obj.gnr}/{property_obj.bnr}").strip()
    estimated_duration_s = estimate_mission_duration(
        route_distance_m=total_distance_m,
        waypoint_count=total_waypoints,
        drone_profile=drone_profile,
    )
    duration_status = planning_duration_status(estimated_duration_s, drone_profile)
    manifest = {
        "format": EXPORT_BUNDLE_FORMAT,
        "generated_at": generated_at,
        "mission_name": mission_name,
        "property": {
            "id": property_obj.id,
            "komm": property_obj.komm,
            "gnr": property_obj.gnr,
            "bnr": property_obj.bnr,
            "fnr": property_obj.fnr,
            "label": property_obj.label,
        },
        "summary": {
            "field_count": len(field_snapshots),
            "waypoint_count": total_waypoints,
            "route_distance_m": round(total_distance_m, 1),
            "estimated_duration_s": estimated_duration_s,
            "duration_status": duration_status,
        },
        "parameters": normalized_parameters,
        "drone_profile": drone_profile or {},
        "recommended_spacing": recommended_spacing or {},
        "warnings": warnings,
        "export_notes": [
            "GeoJSON-bunten er første eksportprofil i Flyvendebønder.",
            "Bruk eksporten som grunnlag for DJI-flyt til vi har en dedikert DJI-missionprofil.",
        ],
    }

    return {
        "name": mission_name,
        "status": "ready",
        "field_ids": [int(field["field_id"]) for field in fields],
        "planning_unit_ids": list(planning_unit_ids or []),
        "drone_profile_id": drone_profile.get("id") if drone_profile else None,
        "drone_profile_snapshot": drone_profile or {},
        "estimated_duration_s": estimated_duration_s,
        "duration_status": duration_status,
        "parameters": normalized_parameters,
        "fields": field_snapshots,
        "warnings": warnings,
        "route_geojson": route_geojson,
        "export_manifest": manifest,
    }


def build_flight_mission_export_bundle(
    *,
    mission_id: int,
    mission_name: str,
    fields: list[dict[str, Any]],
    route_geojson: dict[str, Any],
    export_manifest: dict[str, Any],
) -> bytes:
    _validate_export_bundle_inputs(
        mission_name=mission_name,
        fields=fields,
        route_geojson=route_geojson,
        export_manifest=export_manifest,
    )
    field_features = [
        {
            "type": "Feature",
            "properties": {
                "field_id": field["field_id"],
                "field_name": field["name"],
                "area_m2": field.get("area_m2"),
                "area_ha": field.get("area_ha"),
            },
            "geometry": field["geometry"],
        }
        for field in fields
    ]
    fields_geojson = {"type": "FeatureCollection", "features": field_features}

    slug = _slugify(mission_name) or f"mission-{mission_id}"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(export_manifest, ensure_ascii=False, indent=2))
        archive.writestr("fields.geojson", json.dumps(fields_geojson, ensure_ascii=False, indent=2))
        archive.writestr("route.geojson", json.dumps(route_geojson, ensure_ascii=False, indent=2))
        archive.writestr(
            f"{slug}.readme.txt",
            "\n".join(
                [
                    f"Oppdrag: {mission_name}",
                    "Denne eksporten inneholder jordgrenser og en enkel sweep-rute som bør kontrolleres i planleggingsverktøy før bruk.",
                ]
            ),
        )
    return buffer.getvalue()


def _validate_export_bundle_inputs(
    *,
    mission_name: str,
    fields: list[dict[str, Any]],
    route_geojson: dict[str, Any],
    export_manifest: dict[str, Any],
) -> None:
    if not isinstance(mission_name, str) or not mission_name.strip():
        raise ValueError("Eksporten mangler oppdragsnavn")

    if not isinstance(fields, list) or not fields:
        raise ValueError("Eksporten mangler jordsnapshots")

    for field in fields:
        if not isinstance(field, dict):
            raise ValueError("Eksporten inneholder ugyldige jordsnapshots")
        if not isinstance(field.get("field_id"), int):
            raise ValueError("Eksporten inneholder jord uten gyldig id")
        if not isinstance(field.get("name"), str) or not field["name"].strip():
            raise ValueError("Eksporten inneholder jord uten navn")

        geometry = field.get("geometry")
        if not isinstance(geometry, dict) or geometry.get("type") != "Polygon":
            raise ValueError(f"Eksporten inneholder ugyldig polygon for jord {field['field_id']}")
        coordinates = geometry.get("coordinates")
        if not isinstance(coordinates, list) or not coordinates:
            raise ValueError(f"Eksporten inneholder ugyldig polygon for jord {field['field_id']}")

    if not isinstance(route_geojson, dict) or route_geojson.get("type") != "FeatureCollection":
        raise ValueError("Eksporten mangler gyldig rute-GeoJSON")
    route_features = route_geojson.get("features")
    if not isinstance(route_features, list) or not route_features:
        raise ValueError("Eksporten mangler minst én rute-linje")
    if not any(
        isinstance(feature, dict)
        and isinstance(feature.get("geometry"), dict)
        and feature["geometry"].get("type") == "LineString"
        for feature in route_features
    ):
        raise ValueError("Eksporten mangler minst én rute-linje")

    if not isinstance(export_manifest, dict):
        raise ValueError("Eksporten mangler gyldig manifest")
    if export_manifest.get("format") != EXPORT_BUNDLE_FORMAT:
        raise ValueError("Eksportmanifest har ukjent format")
    if export_manifest.get("mission_name") != mission_name:
        raise ValueError("Eksportmanifest og oppdragsnavn er ute av synk")

    summary = export_manifest.get("summary")
    if not isinstance(summary, dict):
        raise ValueError("Eksportmanifest mangler sammendrag")
    if summary.get("field_count") != len(fields):
        raise ValueError("Eksportmanifest og jorddata er ute av synk")


def _normalize_parameters(parameters: dict[str, Any]) -> dict[str, Any]:
    return {
        "altitude_m": round(float(parameters["altitude_m"]), 2),
        "line_spacing_m": round(float(parameters["line_spacing_m"]), 2),
        "waypoint_spacing_m": round(float(parameters["waypoint_spacing_m"]), 2),
        "route_angle_deg": round(float(parameters["route_angle_deg"]), 2),
        "launch_point": _normalize_geo_point(parameters.get("launch_point")),
        "landing_point": _normalize_geo_point(parameters.get("landing_point")),
        "no_go_buffers": _normalize_no_go_buffers(parameters.get("no_go_buffers") or []),
    }


def estimate_mission_duration(
    *,
    route_distance_m: float,
    waypoint_count: int,
    drone_profile: dict[str, Any] | None,
) -> float | None:
    if drone_profile is None:
        return None

    cruise_speed_mps = max(0.1, float(drone_profile["cruise_speed_mps"]))
    launch_overhead_s = max(0.0, float(drone_profile["launch_overhead_s"]))
    waypoint_turn_overhead_s = max(0.0, float(drone_profile["waypoint_turn_overhead_s"]))
    estimated_duration_s = (route_distance_m / cruise_speed_mps) + launch_overhead_s
    estimated_duration_s += waypoint_turn_overhead_s * max(waypoint_count - 1, 0)
    return round(estimated_duration_s, 1)


def _parameter_warnings(
    parameters: dict[str, Any],
    *,
    recommended_spacing: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    altitude_m = parameters["altitude_m"]
    if altitude_m < RECOMMENDED_ALTITUDE_RANGE_M[0] or altitude_m > RECOMMENDED_ALTITUDE_RANGE_M[1]:
        warnings.append(
            _warning(
                "altitude_outside_recommended",
                "warning",
                f"Flyhøyde {altitude_m:g} m er utenfor anbefalt område {RECOMMENDED_ALTITUDE_RANGE_M[0]:g}-{RECOMMENDED_ALTITUDE_RANGE_M[1]:g} m.",
            )
        )

    line_spacing_m = parameters["line_spacing_m"]
    if line_spacing_m < RECOMMENDED_LINE_SPACING_RANGE_M[0] or line_spacing_m > RECOMMENDED_LINE_SPACING_RANGE_M[1]:
        warnings.append(
            _warning(
                "line_spacing_outside_recommended",
                "warning",
                "Linjeavstand er utenfor anbefalt område og bør kontrolleres mot ønsket dekning.",
            )
        )

    waypoint_spacing_m = parameters["waypoint_spacing_m"]
    if (
        waypoint_spacing_m < RECOMMENDED_WAYPOINT_SPACING_RANGE_M[0]
        or waypoint_spacing_m > RECOMMENDED_WAYPOINT_SPACING_RANGE_M[1]
    ):
        warnings.append(
            _warning(
                "waypoint_spacing_outside_recommended",
                "warning",
                "Avstand mellom waypoint er utenfor anbefalt område og bør kontrolleres mot ønsket dekning.",
            )
        )

    if recommended_spacing is not None:
        line_delta = abs(line_spacing_m - recommended_spacing["line_spacing_m"])
        waypoint_delta = abs(waypoint_spacing_m - recommended_spacing["waypoint_spacing_m"])
        if line_delta > max(4.0, recommended_spacing["line_spacing_m"] * 0.35):
            warnings.append(
                _warning(
                    "line_spacing_differs_from_height_profile",
                    "info",
                    f"Linjeavstand avviker tydelig fra anbefalt verdi ({recommended_spacing['line_spacing_m']:g} m) for valgt høyde og droneprofil.",
                )
            )
        if waypoint_delta > max(4.0, recommended_spacing["waypoint_spacing_m"] * 0.35):
            warnings.append(
                _warning(
                    "waypoint_spacing_differs_from_height_profile",
                    "info",
                    f"Waypoint-avstand avviker tydelig fra anbefalt verdi ({recommended_spacing['waypoint_spacing_m']:g} m) for valgt høyde og droneprofil.",
                )
            )

    if parameters["launch_point"] and parameters["landing_point"]:
        launch = parameters["launch_point"]
        landing = parameters["landing_point"]
        if launch["lat"] == landing["lat"] and launch["lng"] == landing["lng"]:
            warnings.append(
                _warning(
                    "landing_same_as_launch",
                    "info",
                    "Start- og landingspunkt er identiske. Det er lov, men kontroller at plasseringen er trygg.",
                )
            )

    return warnings


def _warning(code: str, severity: str, message: str, *, field_id: int | None = None) -> dict[str, Any]:
    return {"code": code, "severity": severity, "message": message, "field_id": field_id}


def _build_field_route(
    ring: list[list[float]],
    *,
    route_angle_deg: float,
    line_spacing_m: float,
    waypoint_spacing_m: float,
    no_go_buffers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    projected_ring, origin, centroid = _project_ring_to_local_meters(ring)
    base_polygon = Polygon(projected_ring)
    if base_polygon.is_empty or base_polygon.area <= 1:
        return {"points": [], "buffer_count": 0}

    effective_geometry = base_polygon
    applied_buffer_count = 0
    for buffer in no_go_buffers or []:
        projected_center = _project_geo_point_to_local_meters(buffer["center"], origin=origin, centroid=centroid)
        buffered_geometry = Point(projected_center).buffer(float(buffer["radius_m"]), resolution=24)
        if not effective_geometry.intersects(buffered_geometry):
            continue
        effective_geometry = effective_geometry.difference(buffered_geometry)
        applied_buffer_count += 1

    if effective_geometry.is_empty:
        return {"points": [], "buffer_count": applied_buffer_count}

    rotated_geometry = affinity.rotate(effective_geometry, -route_angle_deg, origin=(0, 0), use_radians=False)
    min_x, min_y, max_x, max_y = rotated_geometry.bounds
    if max_y - min_y < 0.5:
        return {"points": [], "buffer_count": applied_buffer_count}

    route_points: list[list[float]] = []
    scan_y = min_y + (line_spacing_m / 2.0)
    reverse = False

    while scan_y <= max_y + 0.001:
        scanline = LineString([(min_x - 5.0, scan_y), (max_x + 5.0, scan_y)])
        intersections = rotated_geometry.intersection(scanline)
        segments = _extract_scanline_segments(intersections)
        if segments:
            segment_points: list[list[float]] = []
            for start_x, end_x in segments:
                if abs(end_x - start_x) < 1.0:
                    continue
                segment = _segment_points(start_x, end_x, scan_y, waypoint_spacing_m)
                if reverse:
                    segment.reverse()
                segment_points.extend(segment)
                reverse = not reverse

            if segment_points:
                for point in segment_points:
                    x_rot, y_rot = _rotate_point(point[0], point[1], route_angle_deg)
                    lng, lat = _local_point_to_lng_lat(x_rot, y_rot, origin=origin, centroid=centroid)
                    if route_points and route_points[-1] == [lng, lat]:
                        continue
                    route_points.append([round(lng, 8), round(lat, 8)])

        scan_y += line_spacing_m

    return {"points": route_points, "buffer_count": applied_buffer_count}


def _project_ring_to_local_meters(
    ring: list[list[float]],
) -> tuple[list[tuple[float, float]], tuple[float, float], tuple[float, float]]:
    points = ring[:-1] if ring and ring[0] == ring[-1] else ring
    avg_lng = sum(point[0] for point in points) / len(points)
    avg_lat = sum(point[1] for point in points) / len(points)
    meters_lat = meters_per_degree_latitude()
    meters_lng = meters_per_degree_longitude(avg_lat)
    projected = [((lng - avg_lng) * meters_lng, (lat - avg_lat) * meters_lat) for lng, lat in ring]
    return projected, (meters_lng, meters_lat), (avg_lng, avg_lat)


def _local_point_to_lng_lat(
    x: float,
    y: float,
    *,
    origin: tuple[float, float],
    centroid: tuple[float, float],
) -> tuple[float, float]:
    meters_lng, meters_lat = origin
    avg_lng, avg_lat = centroid
    lng = avg_lng + (x / meters_lng)
    lat = avg_lat + (y / meters_lat)
    return lng, lat


def _rotate_point(x: float, y: float, angle_deg: float) -> tuple[float, float]:
    angle = math.radians(angle_deg)
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    return (x * cos_a) - (y * sin_a), (x * sin_a) + (y * cos_a)


def _scanline_intersections(ring: list[tuple[float, float]], scan_y: float) -> list[float]:
    intersections: list[float] = []
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]

        if math.isclose(y1, y2, abs_tol=1e-9):
            continue
        if scan_y < min(y1, y2) or scan_y >= max(y1, y2):
            continue

        ratio = (scan_y - y1) / (y2 - y1)
        intersections.append(x1 + (ratio * (x2 - x1)))

    intersections.sort()
    return intersections


def _extract_scanline_segments(intersections: Any) -> list[tuple[float, float]]:
    if intersections.is_empty:
        return []
    if isinstance(intersections, LineString):
        coords = list(intersections.coords)
        if len(coords) < 2:
            return []
        return [(float(coords[0][0]), float(coords[-1][0]))]
    if isinstance(intersections, MultiLineString):
        segments: list[tuple[float, float]] = []
        for line in intersections.geoms:
            coords = list(line.coords)
            if len(coords) < 2:
                continue
            segments.append((float(coords[0][0]), float(coords[-1][0])))
        segments.sort(key=lambda item: item[0])
        return segments
    if isinstance(intersections, GeometryCollection):
        segments: list[tuple[float, float]] = []
        for geometry in intersections.geoms:
            segments.extend(_extract_scanline_segments(geometry))
        segments.sort(key=lambda item: item[0])
        return segments
    return []


def _pair_intersections(intersections: list[float]) -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for index in range(0, len(intersections) - 1, 2):
        start_x = intersections[index]
        end_x = intersections[index + 1]
        if end_x > start_x:
            pairs.append((start_x, end_x))
    return pairs


def _segment_points(start_x: float, end_x: float, scan_y: float, waypoint_spacing_m: float) -> list[list[float]]:
    points = [[start_x, scan_y]]
    distance = abs(end_x - start_x)
    if distance <= waypoint_spacing_m:
        points.append([end_x, scan_y])
        return points

    segment_count = max(1, int(math.ceil(distance / waypoint_spacing_m)))
    for step in range(1, segment_count):
        fraction = step / segment_count
        points.append([start_x + ((end_x - start_x) * fraction), scan_y])
    points.append([end_x, scan_y])
    return points


def _polyline_distance_m(points: list[list[float]]) -> float:
    distance = 0.0
    for current, nxt in zip(points, points[1:]):
        distance += _haversine_distance_m(current[1], current[0], nxt[1], nxt[0])
    return round(distance, 2)


def _haversine_distance_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius_m = 6_371_000.0
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)

    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(d_lng / 2) ** 2
    )
    return 2 * radius_m * math.asin(min(1.0, math.sqrt(a)))


def _normalize_geo_point(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    lat = raw.get("lat")
    lng = raw.get("lng")
    if lat is None or lng is None:
        return None
    lat_value = round(float(lat), 8)
    lng_value = round(float(lng), 8)
    return {"lat": lat_value, "lng": lng_value}


def _normalize_no_go_buffers(raw: list[Any]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            continue
        center = _normalize_geo_point(item.get("center"))
        radius_m = item.get("radius_m")
        if center is None or radius_m is None:
            continue
        radius_value = round(max(3.0, float(radius_m)), 1)
        normalized.append(
            {
                "id": str(item.get("id") or f"buffer-{index + 1}"),
                "name": (str(item.get("name") or "").strip() or None),
                "center": center,
                "radius_m": radius_value,
            }
        )
    return normalized


def _project_geo_point_to_local_meters(
    point: dict[str, float],
    *,
    origin: tuple[float, float],
    centroid: tuple[float, float],
) -> tuple[float, float]:
    meters_lng, meters_lat = origin
    avg_lng, avg_lat = centroid
    return ((point["lng"] - avg_lng) * meters_lng, (point["lat"] - avg_lat) * meters_lat)


def _buffer_feature_geometry(point: dict[str, float], radius_m: float) -> dict[str, Any]:
    lat = point["lat"]
    lng = point["lng"]
    meters_lat = meters_per_degree_latitude()
    meters_lng = meters_per_degree_longitude(lat)
    polygon_points: list[list[float]] = []
    for step in range(0, 25):
        angle = (math.pi * 2 * step) / 24
        x = math.cos(angle) * radius_m
        y = math.sin(angle) * radius_m
        polygon_points.append([round(lng + (x / meters_lng), 8), round(lat + (y / meters_lat), 8)])
    return {"type": "Polygon", "coordinates": [polygon_points]}


def _slugify(value: str) -> str:
    normalized = [
        character.lower() if character.isalnum() else "-"
        for character in value.strip()
    ]
    slug = "".join(normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:80]
