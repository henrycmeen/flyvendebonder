from __future__ import annotations

import json
import math
from datetime import date, datetime
from typing import Any

from shapely.geometry import LineString, Polygon, mapping, shape
from shapely.ops import split as split_geometry
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import FieldPlot, PlanningUnit, Property
from .field_plots import normalize_polygon_coordinates, polygon_area_m2

PLANNING_UNIT_STATUS_ACTIVE = "active"
PLANNING_UNIT_STATUS_ARCHIVED = "archived"
PLANNING_DURATION_WARNING_RATIO = 0.85

DRONE_PROFILES: list[dict[str, Any]] = [
    {
        "id": "dji-mini-4-pro",
        "name": "DJI Mini 4 Pro",
        "cruise_speed_mps": 10.0,
        "capture_interval_s": 2.0,
        "max_mapping_speed_mps": 11.5,
        "launch_overhead_s": 90,
        "waypoint_turn_overhead_s": 4,
        "max_flight_time_s": 1800,
        "reserve_percent": 0.2,
        "ground_footprint_width_ratio": 1.35,
        "ground_footprint_height_ratio": 1.35,
        "target_side_overlap": 0.72,
        "target_front_overlap": 0.72,
        "default_ground_offset_m": 0.0,
        "default_camera_preset_id": "mini4-12mp",
        "camera_presets": [
            {
                "id": "mini4-12mp",
                "name": "DJI Mini 4 Pro (12 MP)",
                "sensor_width_mm": 9.7,
                "sensor_height_mm": 7.3,
                "focal_length_mm": 6.88,
                "image_width_px": 4032,
                "image_height_px": 3024,
            },
            {
                "id": "mini4-48mp",
                "name": "DJI Mini 4 Pro (48 MP)",
                "sensor_width_mm": 9.7,
                "sensor_height_mm": 7.3,
                "focal_length_mm": 6.88,
                "image_width_px": 8064,
                "image_height_px": 6048,
            },
        ],
    },
    {
        "id": "dji-mavic-3-enterprise",
        "name": "DJI Mavic 3 Enterprise",
        "cruise_speed_mps": 13.0,
        "capture_interval_s": 2.0,
        "max_mapping_speed_mps": 12.0,
        "launch_overhead_s": 90,
        "waypoint_turn_overhead_s": 3,
        "max_flight_time_s": 2400,
        "reserve_percent": 0.2,
        "ground_footprint_width_ratio": 1.55,
        "ground_footprint_height_ratio": 1.55,
        "target_side_overlap": 0.75,
        "target_front_overlap": 0.78,
        "default_ground_offset_m": 0.0,
        "camera_presets": [],
    },
    {
        "id": "dji-matrice-30t",
        "name": "DJI Matrice 30T",
        "cruise_speed_mps": 15.0,
        "capture_interval_s": 2.0,
        "max_mapping_speed_mps": 12.0,
        "launch_overhead_s": 120,
        "waypoint_turn_overhead_s": 3,
        "max_flight_time_s": 2100,
        "reserve_percent": 0.22,
        "ground_footprint_width_ratio": 1.55,
        "ground_footprint_height_ratio": 1.55,
        "target_side_overlap": 0.75,
        "target_front_overlap": 0.78,
        "default_ground_offset_m": 0.0,
        "camera_presets": [],
    },
]


def list_drone_profiles() -> list[dict[str, Any]]:
    return [dict(profile) for profile in DRONE_PROFILES]


def get_drone_profile(profile_id: str | None) -> dict[str, Any] | None:
    if profile_id is None:
        return None
    normalized = profile_id.strip()
    for profile in DRONE_PROFILES:
        if profile["id"] == normalized:
            return dict(profile)
    return None


def get_camera_preset(
    profile: dict[str, Any] | None,
    camera_preset_id: str | None = None,
) -> dict[str, Any] | None:
    if profile is None:
        return None
    camera_presets = profile.get("camera_presets") or []
    if not isinstance(camera_presets, list) or len(camera_presets) == 0:
        return None

    normalized_requested = camera_preset_id.strip() if isinstance(camera_preset_id, str) and camera_preset_id.strip() else None
    default_camera_preset_id = profile.get("default_camera_preset_id")
    for preset in camera_presets:
        if normalized_requested and preset.get("id") == normalized_requested:
            return dict(preset)
    if isinstance(default_camera_preset_id, str):
        for preset in camera_presets:
            if preset.get("id") == default_camera_preset_id:
                return dict(preset)
    return dict(camera_presets[0])


def suggest_spacing_for_profile(
    profile: dict[str, Any] | None,
    *,
    altitude_m: float,
    camera_preset_id: str | None = None,
    ground_offset_m: float = 0.0,
) -> dict[str, Any] | None:
    if profile is None or not math.isfinite(altitude_m) or altitude_m <= 0:
        return None

    normalized_ground_offset_m = float(ground_offset_m) if math.isfinite(ground_offset_m) else 0.0
    effective_altitude_m = max(1.0, float(altitude_m) - max(0.0, normalized_ground_offset_m))
    target_side_overlap = float(profile["target_side_overlap"])
    target_front_overlap = float(profile["target_front_overlap"])
    capture_interval_s = max(0.2, float(profile.get("capture_interval_s") or 2.0))
    max_mapping_speed_mps = max(0.5, float(profile.get("max_mapping_speed_mps") or profile["cruise_speed_mps"]))

    camera_preset = get_camera_preset(profile, camera_preset_id)
    if camera_preset is not None:
        sensor_width_mm = float(camera_preset["sensor_width_mm"])
        sensor_height_mm = float(camera_preset["sensor_height_mm"])
        focal_length_mm = float(camera_preset["focal_length_mm"])
        image_width_px = float(camera_preset["image_width_px"])
        image_height_px = float(camera_preset["image_height_px"])

        footprint_width_m = effective_altitude_m * (sensor_width_mm / focal_length_mm)
        footprint_height_m = effective_altitude_m * (sensor_height_mm / focal_length_mm)
        gsd_width_cm = (effective_altitude_m * sensor_width_mm) / (image_width_px * focal_length_mm) * 100
        gsd_height_cm = (effective_altitude_m * sensor_height_mm) / (image_height_px * focal_length_mm) * 100

        waypoint_spacing_m = max(1.0, round(footprint_width_m * (1 - target_front_overlap), 1))
        recommended_ground_speed_mps = min(max_mapping_speed_mps, waypoint_spacing_m / capture_interval_s)
        return {
            "camera_preset_id": camera_preset["id"],
            "line_spacing_m": max(1.0, round(footprint_height_m * (1 - target_side_overlap), 1)),
            "waypoint_spacing_m": waypoint_spacing_m,
            "footprint_width_m": round(footprint_width_m, 2),
            "footprint_height_m": round(footprint_height_m, 2),
            "effective_altitude_m": round(effective_altitude_m, 2),
            "ground_offset_m": round(max(0.0, normalized_ground_offset_m), 2),
            "gsd_width_cm": round(gsd_width_cm, 2),
            "gsd_height_cm": round(gsd_height_cm, 2),
            "capture_interval_s": round(capture_interval_s, 2),
            "recommended_ground_speed_mps": round(recommended_ground_speed_mps, 2),
            "max_mapping_speed_mps": round(max_mapping_speed_mps, 2),
        }

    footprint_width_m = effective_altitude_m * float(profile["ground_footprint_width_ratio"])
    footprint_height_m = effective_altitude_m * float(profile["ground_footprint_height_ratio"])
    waypoint_spacing_m = max(1.0, round(footprint_height_m * (1 - target_front_overlap), 1))
    recommended_ground_speed_mps = min(max_mapping_speed_mps, waypoint_spacing_m / capture_interval_s)
    return {
        "line_spacing_m": max(1.0, round(footprint_width_m * (1 - target_side_overlap), 1)),
        "waypoint_spacing_m": waypoint_spacing_m,
        "effective_altitude_m": round(effective_altitude_m, 2),
        "ground_offset_m": round(max(0.0, normalized_ground_offset_m), 2),
        "capture_interval_s": round(capture_interval_s, 2),
        "recommended_ground_speed_mps": round(recommended_ground_speed_mps, 2),
        "max_mapping_speed_mps": round(max_mapping_speed_mps, 2),
    }


def planning_duration_status(estimated_duration_s: float | None, profile: dict[str, Any] | None) -> str | None:
    if estimated_duration_s is None or profile is None:
        return None
    safe_flight_time_s = float(profile["max_flight_time_s"]) * (1 - float(profile["reserve_percent"]))
    if estimated_duration_s > safe_flight_time_s:
        return "over_limit"
    if estimated_duration_s >= safe_flight_time_s * PLANNING_DURATION_WARNING_RATIO:
        return "warning"
    return "ok"


def planning_unit_field_name(field: FieldPlot) -> str:
    return (field.name or f"Jord {field.id}").strip()


def normalize_source_provenance(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    normalized: dict[str, Any] = {}
    for key, item in value.items():
        if item is None:
            continue
        if isinstance(item, (datetime, date)):
            normalized[str(key)] = item.isoformat()
        elif isinstance(item, (str, int, float, bool)):
            normalized[str(key)] = item
        elif isinstance(item, dict):
            nested = normalize_source_provenance(item)
            if nested:
                normalized[str(key)] = nested
        elif isinstance(item, list):
            normalized_list = [
                entry.isoformat() if isinstance(entry, (datetime, date)) else entry
                for entry in item
                if isinstance(entry, (str, int, float, bool, datetime, date))
            ]
            if normalized_list:
                normalized[str(key)] = normalized_list
    return normalized


def field_source_provenance(field: FieldPlot | None) -> dict[str, Any]:
    if field is None:
        return {}
    try:
        parsed = json.loads(field.source_provenance_json or "{}")
    except (TypeError, json.JSONDecodeError):
        return {}
    return normalize_source_provenance(parsed)


def source_provenance_from_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return normalize_source_provenance(
        {
            "source": candidate.get("source"),
            "source_endpoint": candidate.get("source_endpoint"),
            "source_fetched_at": candidate.get("source_fetched_at"),
            "source_updated_at": candidate.get("source_updated_at"),
            "accuracy_class": candidate.get("accuracy_class"),
            "local_id": candidate.get("local_id"),
            "matrikkelnummer": candidate.get("matrikkelnummer"),
            "object_type": candidate.get("object_type"),
            "land_use_kind": candidate.get("land_use_kind"),
            "land_use_label": candidate.get("land_use_label"),
            "candidate_id": candidate.get("candidate_id"),
            "source_key": candidate.get("source_key"),
            "property_ref": candidate.get("property_ref"),
        }
    )


def planning_unit_payload_from_field(field: FieldPlot) -> dict[str, Any]:
    geometry = {"type": "Polygon", "coordinates": normalize_polygon_coordinates(shape_to_coordinates(field.geometry_json))}
    area_m2 = round(field.area_m2 or polygon_area_m2(geometry["coordinates"]), 2)
    return {
        "field_id": field.id,
        "planning_unit_id": None,
        "name": planning_unit_field_name(field),
        "source": field.source,
        "source_provenance": field_source_provenance(field),
        "geometry": geometry,
        "area_m2": area_m2,
    }


def planning_unit_payload_from_unit(unit: PlanningUnit) -> dict[str, Any]:
    geometry = {"type": "Polygon", "coordinates": normalize_polygon_coordinates(shape_to_coordinates(unit.geometry_json))}
    area_m2 = round(unit.area_m2 or polygon_area_m2(geometry["coordinates"]), 2)
    source_field = unit.source_field_plot
    return {
        "field_id": unit.source_field_plot_id,
        "planning_unit_id": unit.id,
        "name": (unit.name or f"Planenhet {unit.id}").strip(),
        "source": source_field.source if source_field else "manual",
        "source_provenance": field_source_provenance(source_field),
        "geometry": geometry,
        "area_m2": area_m2,
    }


def shape_to_coordinates(raw_geometry_json: str) -> list[list[list[float]]]:
    return json.loads(raw_geometry_json)["coordinates"]


def find_field_plot_for_geometry(
    db: Session,
    *,
    property_obj: Property,
    geometry: dict[str, Any],
) -> FieldPlot | None:
    if geometry.get("type") != "Polygon":
        raise ValueError("Bare polygon-geometri kan brukes som jord")
    coordinates = normalize_polygon_coordinates(geometry.get("coordinates") or [])
    geometry_key = _geometry_key(coordinates)
    existing_fields = (
        db.execute(
            select(FieldPlot)
            .where(FieldPlot.property_id == property_obj.id)
            .order_by(FieldPlot.updated_at.desc(), FieldPlot.id.desc())
        )
        .scalars()
        .all()
    )
    for item in existing_fields:
        if _geometry_key(normalize_polygon_coordinates(shape_to_coordinates(item.geometry_json))) == geometry_key:
            return item
    return None


def create_field_from_candidate(
    db: Session,
    *,
    property_obj: Property,
    candidate: dict[str, Any],
    status: str = "draft",
) -> FieldPlot:
    geometry = candidate.get("geometry") if isinstance(candidate, dict) else None
    if not isinstance(geometry, dict):
        raise ValueError("Kandidaten mangler gyldig geometri")
    if geometry.get("type") != "Polygon":
        raise ValueError("Kandidaten må være et polygon")

    coordinates = normalize_polygon_coordinates(geometry.get("coordinates") or [])
    area_m2 = candidate.get("area_m2")
    if area_m2 is None:
        area_m2 = polygon_area_m2(coordinates)

    item = FieldPlot(
        property_id=property_obj.id,
        name=str(candidate.get("name") or "").strip() or None,
        source="imported",
        status=status,
        geometry_json=json.dumps({"type": "Polygon", "coordinates": coordinates}, ensure_ascii=False),
        area_m2=round(float(area_m2), 2) if area_m2 is not None else None,
        source_provenance_json=json.dumps(source_provenance_from_candidate(candidate), ensure_ascii=False),
        source_key=str(candidate.get("source_key") or candidate.get("candidate_id") or "").strip() or None,
    )
    db.add(item)
    db.flush()
    return item


def ensure_active_planning_unit_for_field(
    db: Session,
    *,
    property_obj: Property,
    field: FieldPlot,
) -> tuple[PlanningUnit, bool]:
    existing = (
        db.execute(
            select(PlanningUnit)
            .where(
                PlanningUnit.property_id == property_obj.id,
                PlanningUnit.source_field_plot_id == field.id,
                PlanningUnit.status == PLANNING_UNIT_STATUS_ACTIVE,
            )
            .order_by(PlanningUnit.updated_at.desc(), PlanningUnit.id.desc())
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing, False

    geometry_json = field.geometry_json
    area_m2 = round(field.area_m2 or polygon_area_m2(normalize_polygon_coordinates(shape_to_coordinates(geometry_json))), 2)
    item = PlanningUnit(
        property_id=property_obj.id,
        source_field_plot_id=field.id,
        parent_unit_id=None,
        name=planning_unit_field_name(field),
        status=PLANNING_UNIT_STATUS_ACTIVE,
        geometry_json=geometry_json,
        area_m2=area_m2,
    )
    db.add(item)
    db.flush()
    return item, True


def sync_fields_from_candidates(
    db: Session,
    *,
    property_obj: Property,
    candidates: list[dict[str, Any]],
    status: str = "draft",
) -> int:
    created_count = 0
    for candidate in candidates:
        geometry = candidate.get("geometry") if isinstance(candidate, dict) else None
        if not isinstance(geometry, dict):
            continue
        if geometry.get("type") != "Polygon":
            continue

        if find_field_plot_for_geometry(db, property_obj=property_obj, geometry=geometry) is not None:
            continue

        create_field_from_candidate(db, property_obj=property_obj, candidate=candidate, status=status)
        created_count += 1

    return created_count


def sync_planning_units(db: Session, *, property_obj: Property) -> tuple[list[PlanningUnit], int]:
    fields = (
        db.execute(
            select(FieldPlot)
            .where(FieldPlot.property_id == property_obj.id, FieldPlot.status.in_(("draft", "confirmed")))
            .order_by(FieldPlot.updated_at.desc(), FieldPlot.id.desc())
        )
        .scalars()
        .all()
    )
    units = (
        db.execute(
            select(PlanningUnit)
            .where(PlanningUnit.property_id == property_obj.id)
            .order_by(PlanningUnit.updated_at.desc(), PlanningUnit.id.desc())
        )
        .scalars()
        .all()
    )

    active_by_source: dict[int, list[PlanningUnit]] = {}
    for unit in units:
        if unit.status != PLANNING_UNIT_STATUS_ACTIVE:
            continue
        active_by_source.setdefault(unit.source_field_plot_id, []).append(unit)

    created_count = 0
    for field in fields:
        active_units = active_by_source.get(field.id, [])
        if active_units:
            if len(active_units) == 1:
                unit = active_units[0]
                if unit.parent_unit_id is None:
                    geometry_json = field.geometry_json
                    area_m2 = round(
                        field.area_m2 or polygon_area_m2(normalize_polygon_coordinates(shape_to_coordinates(geometry_json))),
                        2,
                    )
                    unit.name = planning_unit_field_name(field)
                    unit.geometry_json = geometry_json
                    unit.area_m2 = area_m2
            continue

        geometry_json = field.geometry_json
        area_m2 = round(field.area_m2 or polygon_area_m2(normalize_polygon_coordinates(shape_to_coordinates(geometry_json))), 2)
        item = PlanningUnit(
            property_id=property_obj.id,
            source_field_plot_id=field.id,
            parent_unit_id=None,
            name=planning_unit_field_name(field),
            status=PLANNING_UNIT_STATUS_ACTIVE,
            geometry_json=geometry_json,
            area_m2=area_m2,
        )
        db.add(item)
        created_count += 1

    if created_count:
        db.flush()

    refreshed = (
        db.execute(
            select(PlanningUnit)
            .where(PlanningUnit.property_id == property_obj.id, PlanningUnit.status == PLANNING_UNIT_STATUS_ACTIVE)
            .order_by(PlanningUnit.updated_at.desc(), PlanningUnit.id.desc())
        )
        .scalars()
        .all()
    )
    return refreshed, created_count


def split_planning_unit(unit: PlanningUnit, *, line_coordinates: list[list[float]]) -> list[dict[str, Any]]:
    if len(line_coordinates) < 2:
        raise ValueError("Delingslinjen må ha minst to punkter")

    normalized_line: list[tuple[float, float]] = []
    for point in line_coordinates:
        if len(point) < 2:
            raise ValueError("Delingslinjen inneholder ugyldige punkter")
        lng = float(point[0])
        lat = float(point[1])
        if not math.isfinite(lng) or not math.isfinite(lat):
            raise ValueError("Delingslinjen må ha gyldige koordinater")
        normalized_line.append((lng, lat))

    if len({(round(lng, 9), round(lat, 9)) for lng, lat in normalized_line}) < 2:
        raise ValueError("Delingslinjen må ha to ulike punkter")

    geometry = json.loads(unit.geometry_json)
    polygon = shape(geometry)
    if not isinstance(polygon, Polygon):
        raise ValueError("Bare polygon-planenheter kan deles")

    splitter = _extend_split_line(normalized_line, polygon.bounds)
    result = split_geometry(polygon, splitter)
    polygons = [geom for geom in result.geoms if isinstance(geom, Polygon) and not geom.is_empty]
    if len(polygons) != 2:
        raise ValueError("Delingslinjen må dele jordet i nøyaktig to brukbare deler")

    named_parts = sorted(polygons, key=lambda item: (round(item.centroid.x, 9), round(item.centroid.y, 9)))
    base_name = (unit.name or f"Planenhet {unit.id}").strip()
    parts: list[dict[str, Any]] = []
    for index, part in enumerate(named_parts):
        raw_coordinates = mapping(part)["coordinates"]
        coordinates = normalize_polygon_coordinates(_to_list_coordinates(raw_coordinates))
        area_m2 = round(polygon_area_m2(coordinates), 2)
        if area_m2 <= 1.0:
            raise ValueError("Delingen ga et for lite deljord")
        parts.append(
            {
                "name": f"{base_name} {'A' if index == 0 else 'B'}",
                "geometry": {"type": "Polygon", "coordinates": coordinates},
                "area_m2": area_m2,
            }
        )
    return parts


def _extend_split_line(line_coordinates: list[tuple[float, float]], bounds: tuple[float, float, float, float]) -> LineString:
    start = line_coordinates[0]
    end = line_coordinates[-1]
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    length = math.hypot(dx, dy)
    if length == 0:
        raise ValueError("Delingslinjen må ha to ulike punkter")
    min_x, min_y, max_x, max_y = bounds
    span = max(max_x - min_x, max_y - min_y, 0.001)
    extension = max(span * 4, 0.01)
    ux = dx / length
    uy = dy / length
    return LineString(
        [
            (start[0] - ux * extension, start[1] - uy * extension),
            (end[0] + ux * extension, end[1] + uy * extension),
        ]
    )


def _to_list_coordinates(raw_coordinates: Any) -> list[list[list[float]]]:
    rings: list[list[list[float]]] = []
    for ring in raw_coordinates:
        rings.append([[float(point[0]), float(point[1])] for point in ring])
    return rings


def _geometry_key(coordinates: list[list[list[float]]]) -> tuple[tuple[tuple[float, float], ...], ...]:
    return tuple(
        tuple((round(float(point[0]), 9), round(float(point[1]), 9)) for point in ring)
        for ring in coordinates
    )
