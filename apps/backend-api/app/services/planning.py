from __future__ import annotations

import json
import math
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
        "launch_overhead_s": 90,
        "waypoint_turn_overhead_s": 4,
        "max_flight_time_s": 1800,
        "reserve_percent": 0.2,
    },
    {
        "id": "dji-mavic-3-enterprise",
        "name": "DJI Mavic 3 Enterprise",
        "cruise_speed_mps": 13.0,
        "launch_overhead_s": 90,
        "waypoint_turn_overhead_s": 3,
        "max_flight_time_s": 2400,
        "reserve_percent": 0.2,
    },
    {
        "id": "dji-matrice-30t",
        "name": "DJI Matrice 30T",
        "cruise_speed_mps": 15.0,
        "launch_overhead_s": 120,
        "waypoint_turn_overhead_s": 3,
        "max_flight_time_s": 2100,
        "reserve_percent": 0.22,
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


def planning_unit_payload_from_field(field: FieldPlot) -> dict[str, Any]:
    geometry = {"type": "Polygon", "coordinates": normalize_polygon_coordinates(shape_to_coordinates(field.geometry_json))}
    area_m2 = round(field.area_m2 or polygon_area_m2(geometry["coordinates"]), 2)
    return {
        "field_id": field.id,
        "planning_unit_id": None,
        "name": planning_unit_field_name(field),
        "geometry": geometry,
        "area_m2": area_m2,
    }


def planning_unit_payload_from_unit(unit: PlanningUnit) -> dict[str, Any]:
    geometry = {"type": "Polygon", "coordinates": normalize_polygon_coordinates(shape_to_coordinates(unit.geometry_json))}
    area_m2 = round(unit.area_m2 or polygon_area_m2(geometry["coordinates"]), 2)
    return {
        "field_id": unit.source_field_plot_id,
        "planning_unit_id": unit.id,
        "name": (unit.name or f"Planenhet {unit.id}").strip(),
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


def create_confirmed_field_from_candidate(
    db: Session,
    *,
    property_obj: Property,
    candidate: dict[str, Any],
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
        status="confirmed",
        geometry_json=json.dumps({"type": "Polygon", "coordinates": coordinates}, ensure_ascii=False),
        area_m2=round(float(area_m2), 2) if area_m2 is not None else None,
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


def sync_confirmed_fields_from_candidates(
    db: Session,
    *,
    property_obj: Property,
    candidates: list[dict[str, Any]],
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

        create_confirmed_field_from_candidate(db, property_obj=property_obj, candidate=candidate)
        created_count += 1

    return created_count


def sync_planning_units(db: Session, *, property_obj: Property) -> tuple[list[PlanningUnit], int]:
    fields = (
        db.execute(
            select(FieldPlot)
            .where(FieldPlot.property_id == property_obj.id, FieldPlot.status == "confirmed")
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
