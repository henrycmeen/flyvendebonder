from __future__ import annotations

import io
import json
import math
import zipfile
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

from shapely import affinity
from shapely.geometry import GeometryCollection, LineString, MultiLineString, Polygon
from shapely.ops import unary_union

from ..models import Property
from .field_plots import normalize_polygon_coordinates, polygon_area_m2
from .planning import planning_duration_status, suggest_spacing_for_profile
from .quality_metrics import meters_per_degree_latitude, meters_per_degree_longitude
from .terrain import TERRAIN_SOURCE_KARTVERKET_DEM, TerrainSamplingError, sample_terrain_elevations, summarize_terrain_elevations

RECOMMENDED_ALTITUDE_RANGE_M = (20.0, 120.0)
RECOMMENDED_LINE_SPACING_RANGE_M = (8.0, 35.0)
RECOMMENDED_WAYPOINT_SPACING_RANGE_M = (8.0, 35.0)
MIN_FIELD_AREA_FOR_ROUTE_M2 = 250.0
MIN_RELATIVE_WAYPOINT_HEIGHT_M = 8.0
TERRAIN_MODE_FLAT = "flat"
TERRAIN_MODE_DEM_AGL = "dem_agl"
EXPORT_BUNDLE_FORMAT = "flyvendebonder.flight-mission-bundle.v1"
EXPORT_DJI_WPML_FORMAT = "dji.wpml.kmz.v1"
EXPORT_DJI_FLY_KMZ_FORMAT = "dji.fly.kmz.v1"
KML_NAMESPACE = "http://www.opengis.net/kml/2.2"
DJI_WPML_NAMESPACE = "http://www.dji.com/wpmz/1.0.2"

DJI_WPML_PROFILES: dict[str, dict[str, Any]] = {
    "dji-mavic-3-enterprise": {
        "drone_enum_value": 77,
        "drone_sub_enum_value": 0,
        "payload_enum_value": 66,
        "payload_position_index": 0,
        "payload_lens_index": None,
        "default_speed_mps": 10.0,
    },
    "dji-matrice-30t": {
        "drone_enum_value": 67,
        "drone_sub_enum_value": 1,
        "payload_enum_value": 53,
        "payload_position_index": 0,
        "payload_lens_index": "wide",
        "default_speed_mps": 10.0,
    },
}

DJI_FLY_KMZ_PROFILES: dict[str, dict[str, Any]] = {
    "dji-mini-4-pro": {
        "drone_enum_value": 68,
        "default_speed_mps": 10.0,
        "author": "fly",
        "requires_temporary_mission": True,
        "supports_waypoint_actions": False,
    },
}

ET.register_namespace("", KML_NAMESPACE)
ET.register_namespace("wpml", DJI_WPML_NAMESPACE)


def build_flight_mission_payload(
    *,
    property_obj: Property,
    fields: list[dict[str, Any]],
    name: str | None,
    parameters: dict[str, Any],
    planning_unit_ids: list[int] | None = None,
    drone_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_parameters = _normalize_parameters(parameters, drone_profile=drone_profile)
    recommended_spacing = suggest_spacing_for_profile(
        drone_profile,
        altitude_m=normalized_parameters["altitude_m"],
        camera_preset_id=normalized_parameters.get("camera_preset_id"),
        ground_offset_m=normalized_parameters.get("ground_offset_m", 0.0),
    )
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
                        "width_m": no_go_buffer["width_m"],
                        "height_m": no_go_buffer["height_m"],
                    },
                    "geometry": _no_go_feature_geometry(no_go_buffer),
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
            preferred_start_point=normalized_parameters["launch_point"],
            preferred_end_point=normalized_parameters["landing_point"],
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
            transit_coordinates = _connect_geo_points_avoiding_no_go(
                previous_route_point,
                route_points[0],
                no_go_buffers=normalized_parameters["no_go_buffers"],
            )
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
            transit_coordinates = _connect_geo_points_avoiding_no_go(
                previous_route_point,
                landing_coordinates,
                no_go_buffers=normalized_parameters["no_go_buffers"],
            )
            total_distance_m += _polyline_distance_m(transit_coordinates)
            route_features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "kind": "transit",
                        "name": "Retur til landing",
                    },
                    "geometry": {"type": "LineString", "coordinates": transit_coordinates},
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
    terrain_context = _build_terrain_context(route_geojson=route_geojson, parameters=normalized_parameters)
    warnings.extend(terrain_context["warnings"])
    generated_at = datetime.utcnow().isoformat(timespec="seconds") + "Z"
    mission_name = (name or f"Oppdrag {property_obj.gnr}/{property_obj.bnr}").strip()
    estimated_duration_s = estimate_mission_duration(
        route_distance_m=total_distance_m,
        waypoint_count=total_waypoints,
        drone_profile=drone_profile,
        recommended_spacing=recommended_spacing,
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
            "recommended_ground_speed_mps": recommended_spacing.get("recommended_ground_speed_mps")
            if recommended_spacing
            else None,
        },
        "terrain": terrain_context["summary"],
        "parameters": normalized_parameters,
        "drone_profile": drone_profile or {},
        "recommended_spacing": recommended_spacing or {},
        "warnings": warnings,
        "export_notes": [
            "GeoJSON-bunten er fortsatt tilgjengelig som generell fallback-eksport.",
            "DJI WPML/KMZ brukes for støttede DJI-profiler når det er mulig.",
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


def build_flight_mission_dji_wpml_kmz(
    *,
    mission_id: int,
    mission_name: str,
    route_geojson: dict[str, Any],
    parameters: dict[str, Any],
    drone_profile: dict[str, Any],
    export_manifest: dict[str, Any] | None = None,
) -> bytes:
    _validate_route_geojson_for_export(route_geojson)

    dji_profile = _resolve_dji_wpml_profile(drone_profile)
    if dji_profile is None:
        profile_name = (drone_profile.get("name") or drone_profile.get("id") or "ukjent profil").strip()
        raise ValueError(
            f"DJI WPML-eksport støttes foreløpig ikke for {profile_name}. "
            "Bruk DJI Mavic 3 Enterprise eller DJI Matrice 30T, eller eksporter som generell bundle."
        )

    normalized_parameters = _normalize_parameters(parameters)
    ordered_coordinates = _ordered_route_coordinates(route_geojson)
    if len(ordered_coordinates) < 2:
        raise ValueError("Eksporten mangler minst én rute-linje")
    waypoint_heights_m, takeoff_ref_point = _resolve_export_waypoint_heights(
        ordered_coordinates=ordered_coordinates,
        normalized_parameters=normalized_parameters,
        export_manifest=export_manifest,
    )

    capture_keys = _capture_coordinate_keys(route_geojson)
    timestamp_ms = _utc_timestamp_ms()
    recommended_spacing = suggest_spacing_for_profile(
        drone_profile,
        altitude_m=normalized_parameters["altitude_m"],
        camera_preset_id=normalized_parameters.get("camera_preset_id"),
        ground_offset_m=normalized_parameters.get("ground_offset_m", 0.0),
    )
    speed_mps = _dji_auto_flight_speed_mps(
        drone_profile,
        dji_profile,
        recommended_spacing=recommended_spacing,
    )
    altitude_m = max(max(waypoint_heights_m), 1.2)
    takeoff_security_height_m = round(max(20.0, min(120.0, altitude_m)), 1)
    rth_height_m = round(max(takeoff_security_height_m, altitude_m + 20.0), 1)
    gimbal_pitch_angle = -90.0

    template_xml = _build_dji_template_kml(
        mission_name=mission_name,
        timestamp_ms=timestamp_ms,
        coordinates=ordered_coordinates,
        waypoint_heights_m=waypoint_heights_m,
        capture_keys=capture_keys,
        speed_mps=speed_mps,
        gimbal_pitch_angle=gimbal_pitch_angle,
        takeoff_security_height_m=takeoff_security_height_m,
        normalized_parameters=normalized_parameters,
        dji_profile=dji_profile,
        takeoff_ref_point=takeoff_ref_point,
    )
    waylines_xml = _build_dji_waylines_wpml(
        mission_name=mission_name,
        coordinates=ordered_coordinates,
        waypoint_heights_m=waypoint_heights_m,
        capture_keys=capture_keys,
        speed_mps=speed_mps,
        gimbal_pitch_angle=gimbal_pitch_angle,
        takeoff_security_height_m=takeoff_security_height_m,
        rth_height_m=rth_height_m,
        dji_profile=dji_profile,
    )

    slug = _slugify(mission_name) or f"mission-{mission_id}"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("wpmz/template.kml", template_xml)
        archive.writestr("wpmz/waylines.wpml", waylines_xml)
    buffer.seek(0)
    return buffer.getvalue()


def build_flight_mission_dji_fly_kmz(
    *,
    mission_id: int,
    mission_name: str,
    route_geojson: dict[str, Any],
    parameters: dict[str, Any],
    drone_profile: dict[str, Any],
    export_manifest: dict[str, Any] | None = None,
) -> bytes:
    _validate_route_geojson_for_export(route_geojson)

    dji_profile = _resolve_dji_fly_kmz_profile(drone_profile)
    if dji_profile is None:
        profile_name = (drone_profile.get("name") or drone_profile.get("id") or "ukjent profil").strip()
        raise ValueError(
            f"DJI Fly KMZ-eksport støttes foreløpig ikke for {profile_name}. "
            "Bruk DJI Mini 4 Pro, eller eksporter som generell bundle."
        )

    normalized_parameters = _normalize_parameters(parameters)
    ordered_coordinates = _ordered_route_coordinates(route_geojson)
    if len(ordered_coordinates) < 2:
        raise ValueError("Eksporten mangler minst én rute-linje")
    waypoint_heights_m, takeoff_ref_point = _resolve_export_waypoint_heights(
        ordered_coordinates=ordered_coordinates,
        normalized_parameters=normalized_parameters,
        export_manifest=export_manifest,
    )

    timestamp_ms = _utc_timestamp_ms()
    recommended_spacing = suggest_spacing_for_profile(
        drone_profile,
        altitude_m=normalized_parameters["altitude_m"],
        camera_preset_id=normalized_parameters.get("camera_preset_id"),
        ground_offset_m=normalized_parameters.get("ground_offset_m", 0.0),
    )
    speed_mps = _dji_auto_flight_speed_mps(
        drone_profile,
        dji_profile,
        recommended_spacing=recommended_spacing,
    )
    altitude_m = max(max(waypoint_heights_m), 1.2)
    takeoff_security_height_m = round(max(20.0, min(120.0, altitude_m)), 1)
    rth_height_m = round(max(takeoff_security_height_m, altitude_m + 20.0), 1)
    gimbal_pitch_angle = -90.0
    route_distance_m = _polyline_distance_m(ordered_coordinates)
    route_duration_s = estimate_mission_duration(
        route_distance_m=route_distance_m,
        waypoint_count=len(ordered_coordinates),
        drone_profile=drone_profile,
        recommended_spacing=recommended_spacing,
    )

    template_xml = _build_dji_template_kml(
        mission_name=mission_name,
        timestamp_ms=timestamp_ms,
        coordinates=ordered_coordinates,
        waypoint_heights_m=waypoint_heights_m,
        capture_keys=set(),
        speed_mps=speed_mps,
        gimbal_pitch_angle=gimbal_pitch_angle,
        takeoff_security_height_m=takeoff_security_height_m,
        normalized_parameters=normalized_parameters,
        dji_profile=dji_profile,
        include_payload_info=False,
        author=dji_profile.get("author") or "fly",
        use_straight_line=1,
        takeoff_ref_point=takeoff_ref_point,
    )
    waylines_xml = _build_dji_waylines_wpml(
        mission_name=mission_name,
        coordinates=ordered_coordinates,
        waypoint_heights_m=waypoint_heights_m,
        capture_keys=set(),
        speed_mps=speed_mps,
        gimbal_pitch_angle=gimbal_pitch_angle,
        takeoff_security_height_m=takeoff_security_height_m,
        rth_height_m=rth_height_m,
        dji_profile=dji_profile,
        include_payload_info=False,
        waypoint_turn_mode="coordinateTurn",
        rc_lost_action="goBack",
        exit_on_rc_lost="executeLostAction",
        folder_distance_m=route_distance_m,
        folder_duration_s=route_duration_s,
        use_straight_line=1,
    )

    slug = _slugify(mission_name) or f"mission-{mission_id}"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("wpmz/template.kml", template_xml)
        archive.writestr("wpmz/waylines.wpml", waylines_xml)
        archive.writestr(
            f"{slug}.readme.txt",
            "\n".join(
                [
                    f"Oppdrag: {mission_name}",
                    "DJI Fly / Mini 4 Pro:",
                    "1. Opprett en midlertidig waypoint-rute i DJI Fly.",
                    "2. Lukk DJI Fly helt.",
                    "3. Finn mission-filen i waypoint-mappen på enheten/kontrolleren.",
                    "4. Gi denne KMZ-filen samme navn som den midlertidige mission-filen og erstatt den.",
                    "5. Åpne ruten i DJI Fly og kontroller waypointene før flyging.",
                    "Viktig: Ikke lagre eller rediger missionen på nytt i DJI Fly etter import dersom du vil bevare den eksporterte strukturen.",
                    "Hvis planen bruker Følg terreng, er waypoint-høydene allerede terrengkorrigert i KMZ-filen og skal normalt ikke justeres manuelt i DJI Fly.",
                    "Merk: Intervallfoto for kartlegging må normalt startes manuelt i DJI Fly.",
                ]
            ),
        )
    buffer.seek(0)
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


def _validate_route_geojson_for_export(route_geojson: dict[str, Any]) -> None:
    if not isinstance(route_geojson, dict) or route_geojson.get("type") != "FeatureCollection":
        raise ValueError("Eksporten mangler gyldig rute-GeoJSON")
    route_features = route_geojson.get("features")
    if not isinstance(route_features, list) or not route_features:
        raise ValueError("Eksporten mangler minst én rute-linje")
    if not any(
        isinstance(feature, dict)
        and isinstance(feature.get("geometry"), dict)
        and feature["geometry"].get("type") == "LineString"
        and feature.get("properties", {}).get("kind") in {"route", "transit"}
        for feature in route_features
    ):
        raise ValueError("Eksporten mangler minst én rute-linje")


def _resolve_dji_wpml_profile(drone_profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if drone_profile is None:
        return None
    profile_id = str(drone_profile.get("id") or "").strip()
    profile = DJI_WPML_PROFILES.get(profile_id)
    if profile is None:
        return None
    return {**profile, "id": profile_id, "name": drone_profile.get("name") or profile_id}


def _resolve_dji_fly_kmz_profile(drone_profile: dict[str, Any] | None) -> dict[str, Any] | None:
    if drone_profile is None:
        return None
    profile_id = str(drone_profile.get("id") or "").strip()
    profile = DJI_FLY_KMZ_PROFILES.get(profile_id)
    if profile is None:
        return None
    return {**profile, "id": profile_id, "name": drone_profile.get("name") or profile_id}


def _ordered_route_coordinates(route_geojson: dict[str, Any]) -> list[list[float]]:
    coordinates: list[list[float]] = []
    for feature in route_geojson.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        if geometry.get("type") != "LineString":
            continue
        if properties.get("kind") not in {"route", "transit"}:
            continue
        for raw_point in geometry.get("coordinates") or []:
            point = [round(float(raw_point[0]), 7), round(float(raw_point[1]), 7)]
            if not coordinates or coordinates[-1] != point:
                coordinates.append(point)
    return coordinates


def _capture_coordinate_keys(route_geojson: dict[str, Any]) -> set[str]:
    keys: set[str] = set()
    for feature in route_geojson.get("features", []):
        if not isinstance(feature, dict):
            continue
        geometry = feature.get("geometry") or {}
        properties = feature.get("properties") or {}
        if geometry.get("type") != "Point" or properties.get("kind") != "waypoint":
            continue
        raw_point = geometry.get("coordinates") or []
        if len(raw_point) < 2:
            continue
        keys.add(_coordinate_key(raw_point))
    return keys


def _coordinate_key(point: list[float] | tuple[float, float]) -> str:
    return f"{float(point[0]):.7f},{float(point[1]):.7f}"


def _utc_timestamp_ms() -> int:
    return int(datetime.utcnow().timestamp() * 1000)


def _dji_auto_flight_speed_mps(
    drone_profile: dict[str, Any],
    dji_profile: dict[str, Any],
    *,
    recommended_spacing: dict[str, Any] | None = None,
) -> float:
    configured = drone_profile.get("cruise_speed_mps")
    if configured is None:
        configured = dji_profile["default_speed_mps"]
    speed_mps = max(1.0, min(15.0, float(configured)))
    capture_limited_speed = _recommended_capture_speed_mps(drone_profile=drone_profile, recommended_spacing=recommended_spacing)
    if capture_limited_speed is not None:
        speed_mps = min(speed_mps, capture_limited_speed)
    return round(speed_mps, 1)


def _build_dji_template_kml(
    *,
    mission_name: str,
    timestamp_ms: int,
    coordinates: list[list[float]],
    waypoint_heights_m: list[float],
    capture_keys: set[str],
    speed_mps: float,
    gimbal_pitch_angle: float,
    takeoff_security_height_m: float,
    normalized_parameters: dict[str, Any],
    dji_profile: dict[str, Any],
    takeoff_ref_point: dict[str, float] | None = None,
    include_payload_info: bool = True,
    author: str = "Flyvendebønder",
    use_straight_line: int = 0,
) -> bytes:
    root = ET.Element(_kml_tag("kml"))
    document = ET.SubElement(root, _kml_tag("Document"))
    ET.SubElement(document, _wpml_tag("author")).text = author
    ET.SubElement(document, _wpml_tag("createTime")).text = str(timestamp_ms)
    ET.SubElement(document, _wpml_tag("updateTime")).text = str(timestamp_ms)
    _append_dji_mission_config(
        document,
        dji_profile=dji_profile,
        takeoff_security_height_m=takeoff_security_height_m,
        takeoff_ref_point=takeoff_ref_point,
        global_transitional_speed_mps=speed_mps,
        include_payload_info=include_payload_info,
    )

    folder = ET.SubElement(document, _kml_tag("Folder"))
    ET.SubElement(folder, _wpml_tag("templateType")).text = "waypoint"
    ET.SubElement(folder, _wpml_tag("templateId")).text = "0"
    coordinate_params = ET.SubElement(folder, _wpml_tag("waylineCoordinateSysParam"))
    ET.SubElement(coordinate_params, _wpml_tag("coordinateMode")).text = "WGS84"
    ET.SubElement(coordinate_params, _wpml_tag("heightMode")).text = "relativeToStartPoint"
    ET.SubElement(coordinate_params, _wpml_tag("positioningType")).text = "GPS"
    ET.SubElement(folder, _wpml_tag("autoFlightSpeed")).text = _xml_float(speed_mps)
    ET.SubElement(folder, _wpml_tag("gimbalPitchMode")).text = "usePointSetting"
    global_heading = ET.SubElement(folder, _wpml_tag("globalWaypointHeadingParam"))
    ET.SubElement(global_heading, _wpml_tag("waypointHeadingMode")).text = "followWayline"
    ET.SubElement(global_heading, _wpml_tag("waypointHeadingPathMode")).text = "followBadArc"
    ET.SubElement(folder, _wpml_tag("globalWaypointTurnMode")).text = "toPointAndStopWithDiscontinuityCurvature"
    ET.SubElement(folder, _wpml_tag("globalUseStraightLine")).text = str(int(use_straight_line))

    action_group_id = 0
    capture_index = 0
    for index, point in enumerate(coordinates):
        placemark = ET.SubElement(folder, _kml_tag("Placemark"))
        _append_point_coordinates(placemark, point)
        ET.SubElement(placemark, _wpml_tag("index")).text = str(index)
        ET.SubElement(placemark, _wpml_tag("height")).text = _xml_float(waypoint_heights_m[index])
        ET.SubElement(placemark, _wpml_tag("useGlobalHeight")).text = "1"
        ET.SubElement(placemark, _wpml_tag("useGlobalSpeed")).text = "1"
        ET.SubElement(placemark, _wpml_tag("useGlobalHeadingParam")).text = "1"
        ET.SubElement(placemark, _wpml_tag("useGlobalTurnParam")).text = "1"
        ET.SubElement(placemark, _wpml_tag("useStraightLine")).text = str(int(use_straight_line))
        ET.SubElement(placemark, _wpml_tag("gimbalPitchAngle")).text = _xml_float(gimbal_pitch_angle)
        if _coordinate_key(point) in capture_keys:
            capture_index += 1
            _append_take_photo_action_group(
                placemark,
                action_group_id=action_group_id,
                waypoint_index=index,
                file_suffix=f"shot-{capture_index:04d}",
                dji_profile=dji_profile,
            )
            action_group_id += 1

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _build_dji_waylines_wpml(
    *,
    mission_name: str,
    coordinates: list[list[float]],
    waypoint_heights_m: list[float],
    capture_keys: set[str],
    speed_mps: float,
    gimbal_pitch_angle: float,
    takeoff_security_height_m: float,
    rth_height_m: float,
    dji_profile: dict[str, Any],
    include_payload_info: bool = True,
    waypoint_turn_mode: str = "toPointAndStopWithDiscontinuityCurvature",
    rc_lost_action: str = "hover",
    exit_on_rc_lost: str = "goContinue",
    folder_distance_m: float | None = None,
    folder_duration_s: float | None = None,
    use_straight_line: int = 0,
) -> bytes:
    root = ET.Element(_kml_tag("kml"))
    document = ET.SubElement(root, _kml_tag("Document"))
    _append_dji_mission_config(
        document,
        dji_profile=dji_profile,
        takeoff_security_height_m=takeoff_security_height_m,
        takeoff_ref_point=None,
        global_transitional_speed_mps=speed_mps,
        global_rth_height_m=rth_height_m,
        include_payload_info=include_payload_info,
        rc_lost_action=rc_lost_action,
        exit_on_rc_lost=exit_on_rc_lost,
    )

    folder = ET.SubElement(document, _kml_tag("Folder"))
    ET.SubElement(folder, _wpml_tag("templateId")).text = "0"
    ET.SubElement(folder, _wpml_tag("executeHeightMode")).text = "relativeToStartPoint"
    ET.SubElement(folder, _wpml_tag("waylineId")).text = "0"
    if folder_distance_m is not None:
        ET.SubElement(folder, _wpml_tag("distance")).text = str(int(round(folder_distance_m)))
    if folder_duration_s is not None:
        ET.SubElement(folder, _wpml_tag("duration")).text = str(int(round(folder_duration_s)))
    ET.SubElement(folder, _wpml_tag("autoFlightSpeed")).text = _xml_float(speed_mps)

    action_group_id = 0
    capture_index = 0
    for index, point in enumerate(coordinates):
        placemark = ET.SubElement(folder, _kml_tag("Placemark"))
        _append_point_coordinates(placemark, point)
        ET.SubElement(placemark, _wpml_tag("index")).text = str(index)
        ET.SubElement(placemark, _wpml_tag("executeHeight")).text = _xml_float(waypoint_heights_m[index])
        ET.SubElement(placemark, _wpml_tag("waypointSpeed")).text = _xml_float(speed_mps)
        heading = ET.SubElement(placemark, _wpml_tag("waypointHeadingParam"))
        ET.SubElement(heading, _wpml_tag("waypointHeadingMode")).text = "followWayline"
        ET.SubElement(heading, _wpml_tag("waypointHeadingPathMode")).text = "followBadArc"
        turn = ET.SubElement(placemark, _wpml_tag("waypointTurnParam"))
        ET.SubElement(turn, _wpml_tag("waypointTurnMode")).text = waypoint_turn_mode
        ET.SubElement(turn, _wpml_tag("waypointTurnDampingDist")).text = "0"
        ET.SubElement(placemark, _wpml_tag("useStraightLine")).text = str(int(use_straight_line))
        ET.SubElement(placemark, _wpml_tag("gimbalPitchAngle")).text = _xml_float(gimbal_pitch_angle)
        if _coordinate_key(point) in capture_keys:
            capture_index += 1
            _append_take_photo_action_group(
                placemark,
                action_group_id=action_group_id,
                waypoint_index=index,
                file_suffix=f"shot-{capture_index:04d}",
                dji_profile=dji_profile,
            )
            action_group_id += 1

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _append_dji_mission_config(
    document: ET.Element,
    *,
    dji_profile: dict[str, Any],
    takeoff_security_height_m: float,
    takeoff_ref_point: dict[str, float] | None,
    global_transitional_speed_mps: float,
    global_rth_height_m: float | None = None,
    include_payload_info: bool = True,
    rc_lost_action: str = "hover",
    exit_on_rc_lost: str = "goContinue",
) -> None:
    mission_config = ET.SubElement(document, _wpml_tag("missionConfig"))
    ET.SubElement(mission_config, _wpml_tag("flyToWaylineMode")).text = "safely"
    ET.SubElement(mission_config, _wpml_tag("finishAction")).text = "goHome"
    ET.SubElement(mission_config, _wpml_tag("exitOnRCLost")).text = exit_on_rc_lost
    ET.SubElement(mission_config, _wpml_tag("executeRCLostAction")).text = rc_lost_action
    ET.SubElement(mission_config, _wpml_tag("takeOffSecurityHeight")).text = _xml_float(takeoff_security_height_m)
    ET.SubElement(mission_config, _wpml_tag("globalTransitionalSpeed")).text = _xml_float(global_transitional_speed_mps)
    if global_rth_height_m is not None:
        ET.SubElement(mission_config, _wpml_tag("globalRTHHeight")).text = _xml_float(global_rth_height_m)
    if takeoff_ref_point is not None:
        ET.SubElement(mission_config, _wpml_tag("takeOffRefPoint")).text = (
            f"{takeoff_ref_point['lat']:.7f},{takeoff_ref_point['lng']:.7f},0"
        )
        ET.SubElement(mission_config, _wpml_tag("takeOffRefPointAGLHeight")).text = _xml_float(
            takeoff_security_height_m
        )

    drone_info = ET.SubElement(mission_config, _wpml_tag("droneInfo"))
    ET.SubElement(drone_info, _wpml_tag("droneEnumValue")).text = str(dji_profile["drone_enum_value"])
    if dji_profile.get("drone_sub_enum_value") is not None:
        ET.SubElement(drone_info, _wpml_tag("droneSubEnumValue")).text = str(dji_profile["drone_sub_enum_value"])

    if include_payload_info:
        payload_info = ET.SubElement(mission_config, _wpml_tag("payloadInfo"))
        ET.SubElement(payload_info, _wpml_tag("payloadEnumValue")).text = str(dji_profile["payload_enum_value"])
        ET.SubElement(payload_info, _wpml_tag("payloadPositionIndex")).text = str(dji_profile["payload_position_index"])


def _append_point_coordinates(parent: ET.Element, point: list[float]) -> None:
    point_node = ET.SubElement(parent, _kml_tag("Point"))
    coordinates = ET.SubElement(point_node, _kml_tag("coordinates"))
    coordinates.text = f"{float(point[0]):.7f},{float(point[1]):.7f}"


def _append_take_photo_action_group(
    placemark: ET.Element,
    *,
    action_group_id: int,
    waypoint_index: int,
    file_suffix: str,
    dji_profile: dict[str, Any],
) -> None:
    action_group = ET.SubElement(placemark, _wpml_tag("actionGroup"))
    ET.SubElement(action_group, _wpml_tag("actionGroupId")).text = str(action_group_id)
    ET.SubElement(action_group, _wpml_tag("actionGroupStartIndex")).text = str(waypoint_index)
    ET.SubElement(action_group, _wpml_tag("actionGroupEndIndex")).text = str(waypoint_index)
    ET.SubElement(action_group, _wpml_tag("actionGroupMode")).text = "sequence"
    trigger = ET.SubElement(action_group, _wpml_tag("actionTrigger"))
    ET.SubElement(trigger, _wpml_tag("actionTriggerType")).text = "reachPoint"
    action = ET.SubElement(action_group, _wpml_tag("action"))
    ET.SubElement(action, _wpml_tag("actionId")).text = "0"
    ET.SubElement(action, _wpml_tag("actionActuatorFunc")).text = "takePhoto"
    params = ET.SubElement(action, _wpml_tag("actionActuatorFuncParam"))
    ET.SubElement(params, _wpml_tag("fileSuffix")).text = file_suffix
    ET.SubElement(params, _wpml_tag("payloadPositionIndex")).text = str(dji_profile["payload_position_index"])
    if dji_profile.get("payload_lens_index"):
        ET.SubElement(params, _wpml_tag("payloadLensIndex")).text = str(dji_profile["payload_lens_index"])
        ET.SubElement(params, _wpml_tag("useGlobalPayloadLensIndex")).text = "0"


def _kml_tag(name: str) -> str:
    return f"{{{KML_NAMESPACE}}}{name}"


def _wpml_tag(name: str) -> str:
    return f"{{{DJI_WPML_NAMESPACE}}}{name}"


def _xml_float(value: float) -> str:
    text = f"{float(value):.3f}"
    return text.rstrip("0").rstrip(".")


def _normalize_parameters(
    parameters: dict[str, Any],
    *,
    drone_profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized = {
        "altitude_m": round(float(parameters["altitude_m"]), 2),
        "line_spacing_m": round(float(parameters["line_spacing_m"]), 2),
        "waypoint_spacing_m": round(float(parameters["waypoint_spacing_m"]), 2),
        "route_angle_deg": round(float(parameters["route_angle_deg"]), 2),
        "terrain_mode": _normalize_terrain_mode(parameters.get("terrain_mode")),
        "camera_preset_id": (str(parameters.get("camera_preset_id")).strip() or None)
        if parameters.get("camera_preset_id") is not None
        else None,
        "ground_offset_m": round(max(0.0, float(parameters.get("ground_offset_m") or 0.0)), 2),
        "launch_point": _normalize_geo_point(parameters.get("launch_point")),
        "landing_point": _normalize_geo_point(parameters.get("landing_point")),
        "no_go_buffers": _normalize_no_go_buffers(parameters.get("no_go_buffers") or []),
    }
    suggested_spacing = suggest_spacing_for_profile(
        drone_profile,
        altitude_m=normalized["altitude_m"],
        camera_preset_id=normalized["camera_preset_id"],
        ground_offset_m=normalized["ground_offset_m"],
    )
    if suggested_spacing is not None:
        normalized["line_spacing_m"] = suggested_spacing["line_spacing_m"]
        normalized["waypoint_spacing_m"] = suggested_spacing["waypoint_spacing_m"]
    return normalized


def _normalize_terrain_mode(raw: Any) -> str:
    normalized = str(raw or TERRAIN_MODE_FLAT).strip().lower()
    if normalized == TERRAIN_MODE_DEM_AGL:
        return TERRAIN_MODE_DEM_AGL
    return TERRAIN_MODE_FLAT


def _build_terrain_context(
    *,
    route_geojson: dict[str, Any],
    parameters: dict[str, Any],
) -> dict[str, Any]:
    ordered_coordinates = _ordered_route_coordinates(route_geojson)
    requested_mode = parameters.get("terrain_mode", TERRAIN_MODE_FLAT)
    summary: dict[str, Any] = {
        "terrain_mode": TERRAIN_MODE_FLAT,
        "requested_terrain_mode": requested_mode,
        "terrain_source": None,
        "takeoff_reference_point": None,
        "takeoff_reference_elevation_m": None,
        "min_terrain_elevation_m": None,
        "max_terrain_elevation_m": None,
        "min_relative_waypoint_height_m": round(float(parameters["altitude_m"]), 2),
        "max_relative_waypoint_height_m": round(float(parameters["altitude_m"]), 2),
        "relative_waypoint_heights_m": [round(float(parameters["altitude_m"]), 2) for _ in ordered_coordinates],
    }
    warnings: list[dict[str, Any]] = []
    if not ordered_coordinates:
        return {"summary": summary, "warnings": warnings}

    reference_point = parameters.get("launch_point") or {"lng": ordered_coordinates[0][0], "lat": ordered_coordinates[0][1]}
    summary["takeoff_reference_point"] = reference_point

    elevations: list[float | None] | None = None
    min_elevation_m: float | None = None
    max_elevation_m: float | None = None
    takeoff_reference_elevation_m: float | None = None

    try:
        sample_points = [{"lng": point[0], "lat": point[1]} for point in ordered_coordinates]
        elevations = sample_terrain_elevations(sample_points)
        min_elevation_m, max_elevation_m = summarize_terrain_elevations(elevations)
        takeoff_reference_elevation_m = _sample_reference_elevation(reference_point=reference_point, ordered_coordinates=ordered_coordinates, elevations=elevations)
        summary["terrain_source"] = TERRAIN_SOURCE_KARTVERKET_DEM
        summary["takeoff_reference_elevation_m"] = takeoff_reference_elevation_m
        summary["min_terrain_elevation_m"] = min_elevation_m
        summary["max_terrain_elevation_m"] = max_elevation_m
    except Exception:
        elevations = None

    flat_altitudes = [round(float(parameters["altitude_m"]), 2) for _ in ordered_coordinates]
    if requested_mode != TERRAIN_MODE_DEM_AGL:
        summary["relative_waypoint_heights_m"] = flat_altitudes
        if min_elevation_m is not None and max_elevation_m is not None and (max_elevation_m - min_elevation_m) >= 10:
            warnings.append(
                _warning(
                    "terrain_following_recommended",
                    "info",
                    f"Terrenget varierer {max_elevation_m - min_elevation_m:.1f} m langs ruta. Følg terreng anbefales.",
                )
            )
        return {"summary": summary, "warnings": warnings}

    if parameters.get("launch_point") is None:
        warnings.append(
            _warning(
                "terrain_reference_defaults_to_route_start",
                "info",
                "Følg terreng bruker første rute-punkt som referanse til du setter et startpunkt.",
            )
        )

    if elevations is None or any(elevation is None for elevation in elevations) or takeoff_reference_elevation_m is None:
        summary["relative_waypoint_heights_m"] = flat_altitudes
        warnings.append(
            _warning(
                "terrain_data_unavailable_fallback_flat",
                "warning",
                "Terrengdata mangler for deler av ruta. Planen falt tilbake til flat høyde.",
            )
        )
        return {"summary": summary, "warnings": warnings}

    relative_heights: list[float] = []
    clamp_count = 0
    desired_agl_m = float(parameters["altitude_m"])
    for elevation in elevations:
        assert elevation is not None
        relative_height_m = desired_agl_m + (float(elevation) - float(takeoff_reference_elevation_m))
        if relative_height_m < MIN_RELATIVE_WAYPOINT_HEIGHT_M:
            relative_height_m = MIN_RELATIVE_WAYPOINT_HEIGHT_M
            clamp_count += 1
        relative_heights.append(round(relative_height_m, 2))

    summary["terrain_mode"] = TERRAIN_MODE_DEM_AGL
    summary["relative_waypoint_heights_m"] = relative_heights
    summary["min_relative_waypoint_height_m"] = round(min(relative_heights), 2)
    summary["max_relative_waypoint_height_m"] = round(max(relative_heights), 2)
    if clamp_count > 0:
        warnings.append(
            _warning(
                "terrain_height_clamped",
                "warning",
                f"{clamp_count} waypoint-høyde(r) ble løftet til minst {MIN_RELATIVE_WAYPOINT_HEIGHT_M:g} m over startreferansen.",
            )
        )
    return {"summary": summary, "warnings": warnings}


def _sample_reference_elevation(
    *,
    reference_point: dict[str, float],
    ordered_coordinates: list[list[float]],
    elevations: list[float | None],
) -> float | None:
    reference_key = _coordinate_key([reference_point["lng"], reference_point["lat"]])
    for index, coordinate in enumerate(ordered_coordinates):
        if _coordinate_key(coordinate) == reference_key:
            elevation = elevations[index]
            return round(float(elevation), 2) if elevation is not None else None

    sampled = sample_terrain_elevations([reference_point])
    if not sampled or sampled[0] is None:
        return None
    return round(float(sampled[0]), 2)


def _resolve_export_waypoint_heights(
    *,
    ordered_coordinates: list[list[float]],
    normalized_parameters: dict[str, Any],
    export_manifest: dict[str, Any] | None,
) -> tuple[list[float], dict[str, float] | None]:
    default_altitude = round(float(normalized_parameters["altitude_m"]), 2)
    terrain = export_manifest.get("terrain") if isinstance(export_manifest, dict) else None
    if isinstance(terrain, dict):
        raw_heights = terrain.get("relative_waypoint_heights_m")
        if isinstance(raw_heights, list) and len(raw_heights) == len(ordered_coordinates):
            heights = [round(float(value), 2) for value in raw_heights]
            raw_ref_point = terrain.get("takeoff_reference_point")
            takeoff_ref_point = raw_ref_point if isinstance(raw_ref_point, dict) and "lat" in raw_ref_point and "lng" in raw_ref_point else None
            return heights, takeoff_ref_point
    takeoff_ref_point = normalized_parameters.get("launch_point")
    if takeoff_ref_point is None and ordered_coordinates:
        takeoff_ref_point = {"lng": ordered_coordinates[0][0], "lat": ordered_coordinates[0][1]}
    return [default_altitude for _ in ordered_coordinates], takeoff_ref_point


def estimate_mission_duration(
    *,
    route_distance_m: float,
    waypoint_count: int,
    drone_profile: dict[str, Any] | None,
    recommended_spacing: dict[str, Any] | None = None,
) -> float | None:
    if drone_profile is None:
        return None

    cruise_speed_mps = max(0.1, float(drone_profile["cruise_speed_mps"]))
    capture_limited_speed = _recommended_capture_speed_mps(drone_profile=drone_profile, recommended_spacing=recommended_spacing)
    effective_speed_mps = min(cruise_speed_mps, capture_limited_speed) if capture_limited_speed is not None else cruise_speed_mps
    launch_overhead_s = max(0.0, float(drone_profile["launch_overhead_s"]))
    waypoint_turn_overhead_s = max(0.0, float(drone_profile["waypoint_turn_overhead_s"]))
    estimated_duration_s = (route_distance_m / effective_speed_mps) + launch_overhead_s
    estimated_duration_s += waypoint_turn_overhead_s * max(waypoint_count - 1, 0)
    return round(estimated_duration_s, 1)


def _recommended_capture_speed_mps(
    *,
    drone_profile: dict[str, Any] | None,
    recommended_spacing: dict[str, Any] | None,
) -> float | None:
    if drone_profile is None or not recommended_spacing:
        return None
    recommended_speed = recommended_spacing.get("recommended_ground_speed_mps")
    if recommended_speed is None or not math.isfinite(float(recommended_speed)):
        return None
    max_mapping_speed = drone_profile.get("max_mapping_speed_mps")
    speed_mps = max(0.1, float(recommended_speed))
    if max_mapping_speed is not None and math.isfinite(float(max_mapping_speed)):
        speed_mps = min(speed_mps, float(max_mapping_speed))
    return round(speed_mps, 2)


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
    preferred_start_point: dict[str, float] | None = None,
    preferred_end_point: dict[str, float] | None = None,
) -> dict[str, Any]:
    projected_ring, origin, centroid = _project_ring_to_local_meters(ring)
    base_polygon = Polygon(projected_ring)
    if base_polygon.is_empty or base_polygon.area <= 1:
        return {"points": [], "buffer_count": 0}

    effective_geometry = base_polygon
    applied_buffer_count = 0
    no_go_geometries_local: list[Polygon] = []
    for buffer in no_go_buffers or []:
        no_go_geometry = _no_go_geometry_local(buffer, origin=origin, centroid=centroid)
        if no_go_geometry is None or no_go_geometry.is_empty:
            continue
        no_go_geometries_local.append(no_go_geometry)
        if not effective_geometry.intersects(no_go_geometry):
            continue
        effective_geometry = effective_geometry.difference(no_go_geometry)
        applied_buffer_count += 1

    if effective_geometry.is_empty:
        return {"points": [], "buffer_count": applied_buffer_count}

    rotated_geometry = affinity.rotate(effective_geometry, -route_angle_deg, origin=(0, 0), use_radians=False)
    rotated_no_go_geometries = [
        affinity.rotate(geometry, -route_angle_deg, origin=(0, 0), use_radians=False) for geometry in no_go_geometries_local
    ]
    min_x, min_y, max_x, max_y = rotated_geometry.bounds
    if max_y - min_y < 0.5:
        return {"points": [], "buffer_count": applied_buffer_count}

    route_points_rotated: list[list[float]] = []
    scan_y = min_y + (line_spacing_m / 2.0)
    reverse = False
    previous_rotated_point: list[float] | None = None

    while scan_y <= max_y + 0.001:
        scanline = LineString([(min_x - 5.0, scan_y), (max_x + 5.0, scan_y)])
        intersections = rotated_geometry.intersection(scanline)
        segments = _extract_scanline_segments(intersections)
        if segments:
            for start_x, end_x in segments:
                if abs(end_x - start_x) < 1.0:
                    continue
                segment = _segment_points(start_x, end_x, scan_y, waypoint_spacing_m)
                if reverse:
                    segment.reverse()
                reverse = not reverse
                if not segment:
                    continue
                if previous_rotated_point is not None and previous_rotated_point != segment[0]:
                    connector = _connect_points_avoiding_no_go(
                        previous_rotated_point,
                        segment[0],
                        no_go_geometries=rotated_no_go_geometries,
                    )
                    for point in connector[1:]:
                        if route_points_rotated and route_points_rotated[-1] == point:
                            continue
                        route_points_rotated.append(point)

                for point in segment:
                    if route_points_rotated and route_points_rotated[-1] == point:
                        continue
                    route_points_rotated.append(point)
                previous_rotated_point = segment[-1]

        scan_y += line_spacing_m

    route_points: list[list[float]] = []
    for point in route_points_rotated:
        x_rot, y_rot = _rotate_point(point[0], point[1], route_angle_deg)
        lng, lat = _local_point_to_lng_lat(x_rot, y_rot, origin=origin, centroid=centroid)
        if route_points and route_points[-1] == [round(lng, 8), round(lat, 8)]:
            continue
        route_points.append([round(lng, 8), round(lat, 8)])

    route_points = _optimize_route_direction_for_launch_and_landing(
        route_points,
        preferred_start_point=preferred_start_point,
        preferred_end_point=preferred_end_point,
    )

    return {"points": route_points, "buffer_count": applied_buffer_count}


def _optimize_route_direction_for_launch_and_landing(
    route_points: list[list[float]],
    *,
    preferred_start_point: dict[str, float] | None,
    preferred_end_point: dict[str, float] | None,
) -> list[list[float]]:
    if len(route_points) < 2:
        return route_points
    if preferred_start_point is None and preferred_end_point is None:
        return route_points

    reversed_points = list(reversed(route_points))
    forward_score = _route_endpoint_score(
        route_points,
        preferred_start_point=preferred_start_point,
        preferred_end_point=preferred_end_point,
    )
    reversed_score = _route_endpoint_score(
        reversed_points,
        preferred_start_point=preferred_start_point,
        preferred_end_point=preferred_end_point,
    )
    return reversed_points if reversed_score + 0.01 < forward_score else route_points


def _route_endpoint_score(
    route_points: list[list[float]],
    *,
    preferred_start_point: dict[str, float] | None,
    preferred_end_point: dict[str, float] | None,
) -> float:
    score = 0.0
    if preferred_start_point is not None:
        score += _haversine_distance_m(
            preferred_start_point["lat"],
            preferred_start_point["lng"],
            route_points[0][1],
            route_points[0][0],
        )
    if preferred_end_point is not None:
        score += _haversine_distance_m(
            route_points[-1][1],
            route_points[-1][0],
            preferred_end_point["lat"],
            preferred_end_point["lng"],
        )
    return score


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
        width_m = item.get("width_m")
        height_m = item.get("height_m")
        radius_m = item.get("radius_m")
        if center is None and not isinstance(item.get("bounds"), dict):
            continue
        if width_m is None and radius_m is not None:
            width_m = float(radius_m) * 2
        if height_m is None and radius_m is not None:
            height_m = float(radius_m) * 2
        if width_m is None or height_m is None:
            continue
        width_value = round(max(6.0, float(width_m)), 1)
        height_value = round(max(6.0, float(height_m)), 1)
        normalized.append(
            {
                "id": str(item.get("id") or f"buffer-{index + 1}"),
                "name": (str(item.get("name") or "").strip() or None),
                "center": center,
                "width_m": width_value,
                "height_m": height_value,
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


def _no_go_geometry_local(
    no_go_buffer: dict[str, Any],
    *,
    origin: tuple[float, float],
    centroid: tuple[float, float],
) -> Polygon | None:
    center = no_go_buffer.get("center")
    if not isinstance(center, dict):
        return None
    projected_center = _project_geo_point_to_local_meters(center, origin=origin, centroid=centroid)
    width_m = float(no_go_buffer.get("width_m") or 0)
    height_m = float(no_go_buffer.get("height_m") or 0)
    if width_m <= 0 or height_m <= 0:
        return None
    half_width = width_m / 2.0
    half_height = height_m / 2.0
    center_x, center_y = projected_center
    return Polygon(
        [
            (center_x - half_width, center_y - half_height),
            (center_x + half_width, center_y - half_height),
            (center_x + half_width, center_y + half_height),
            (center_x - half_width, center_y + half_height),
            (center_x - half_width, center_y - half_height),
        ]
    )


def _no_go_feature_geometry(no_go_buffer: dict[str, Any]) -> dict[str, Any]:
    center = no_go_buffer["center"]
    lat = center["lat"]
    lng = center["lng"]
    meters_lat = meters_per_degree_latitude()
    meters_lng = meters_per_degree_longitude(lat)
    half_width = float(no_go_buffer["width_m"]) / 2.0
    half_height = float(no_go_buffer["height_m"]) / 2.0
    polygon_points = [
        [round(lng - (half_width / meters_lng), 8), round(lat - (half_height / meters_lat), 8)],
        [round(lng + (half_width / meters_lng), 8), round(lat - (half_height / meters_lat), 8)],
        [round(lng + (half_width / meters_lng), 8), round(lat + (half_height / meters_lat), 8)],
        [round(lng - (half_width / meters_lng), 8), round(lat + (half_height / meters_lat), 8)],
        [round(lng - (half_width / meters_lng), 8), round(lat - (half_height / meters_lat), 8)],
    ]
    return {"type": "Polygon", "coordinates": [polygon_points]}


def _connect_points_avoiding_no_go(
    start: list[float],
    end: list[float],
    *,
    no_go_geometries: list[Polygon],
) -> list[list[float]]:
    direct_segment = LineString([tuple(start), tuple(end)])
    blocking_geometry = next(
        (
            geometry
            for geometry in no_go_geometries
            if not geometry.is_empty and (direct_segment.crosses(geometry) or direct_segment.within(geometry) or direct_segment.intersects(geometry))
        ),
        None,
    )
    if blocking_geometry is None:
        return [start, end]

    min_x, min_y, max_x, max_y = blocking_geometry.bounds
    margin = 4.0
    candidates = [
        [start, [start[0], max_y + margin], [end[0], max_y + margin], end],
        [start, [start[0], min_y - margin], [end[0], min_y - margin], end],
        [start, [max_x + margin, start[1]], [max_x + margin, end[1]], end],
        [start, [min_x - margin, start[1]], [min_x - margin, end[1]], end],
    ]

    valid_candidates: list[list[list[float]]] = []
    for candidate in candidates:
        if _path_intersects_no_go(candidate, no_go_geometries):
            continue
        valid_candidates.append(candidate)

    if not valid_candidates:
        return [start, end]

    valid_candidates.sort(key=_polyline_distance_local_m)
    return valid_candidates[0]


def _connect_geo_points_avoiding_no_go(
    start: list[float],
    end: list[float],
    *,
    no_go_buffers: list[dict[str, Any]],
) -> list[list[float]]:
    direct_segment = LineString([tuple(start), tuple(end)])
    blocking_buffer = next(
        (
            buffer
            for buffer in no_go_buffers
            if _line_intersects_no_go_feature(direct_segment, _no_go_feature_geometry(buffer))
        ),
        None,
    )
    if blocking_buffer is None:
        return [start, end]

    center = blocking_buffer["center"]
    meters_lat = meters_per_degree_latitude()
    meters_lng = meters_per_degree_longitude(center["lat"])
    margin_x = 6.0 / meters_lng
    margin_y = 6.0 / meters_lat
    half_width = float(blocking_buffer["width_m"]) / 2.0 / meters_lng
    half_height = float(blocking_buffer["height_m"]) / 2.0 / meters_lat
    min_lng = center["lng"] - half_width
    max_lng = center["lng"] + half_width
    min_lat = center["lat"] - half_height
    max_lat = center["lat"] + half_height

    candidates = [
        [start, [start[0], max_lat + margin_y], [end[0], max_lat + margin_y], end],
        [start, [start[0], min_lat - margin_y], [end[0], min_lat - margin_y], end],
        [start, [max_lng + margin_x, start[1]], [max_lng + margin_x, end[1]], end],
        [start, [min_lng - margin_x, start[1]], [min_lng - margin_x, end[1]], end],
    ]

    valid_candidates = [
        candidate
        for candidate in candidates
        if not _geo_path_intersects_no_go(candidate, no_go_buffers)
    ]
    if not valid_candidates:
        return [start, end]
    valid_candidates.sort(key=_polyline_distance_m)
    return valid_candidates[0]


def _path_intersects_no_go(path: list[list[float]], no_go_geometries: list[Polygon]) -> bool:
    for current, nxt in zip(path, path[1:]):
        segment = LineString([tuple(current), tuple(nxt)])
        for geometry in no_go_geometries:
            if geometry.is_empty:
                continue
            if segment.crosses(geometry) or segment.within(geometry):
                return True
            if segment.intersects(geometry) and not segment.touches(geometry):
                return True
    return False


def _geo_path_intersects_no_go(path: list[list[float]], no_go_buffers: list[dict[str, Any]]) -> bool:
    for current, nxt in zip(path, path[1:]):
        segment = LineString([tuple(current), tuple(nxt)])
        for buffer in no_go_buffers:
            if _line_intersects_no_go_feature(segment, _no_go_feature_geometry(buffer)):
                return True
    return False


def _line_intersects_no_go_feature(segment: LineString, geometry: dict[str, Any]) -> bool:
    no_go_polygon = Polygon(geometry["coordinates"][0])
    if segment.crosses(no_go_polygon) or segment.within(no_go_polygon):
        return True
    return segment.intersects(no_go_polygon) and not segment.touches(no_go_polygon)


def _polyline_distance_local_m(path: list[list[float]]) -> float:
    distance = 0.0
    for current, nxt in zip(path, path[1:]):
        distance += math.hypot(nxt[0] - current[0], nxt[1] - current[1])
    return distance


def _slugify(value: str) -> str:
    normalized = [
        character.lower() if character.isalnum() else "-"
        for character in value.strip()
    ]
    slug = "".join(normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:80]
