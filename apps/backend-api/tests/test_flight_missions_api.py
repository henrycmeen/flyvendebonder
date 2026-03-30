from __future__ import annotations

import io
import json
import zipfile
from xml.etree import ElementTree as ET

import pytest
from shapely.geometry import shape
from sqlalchemy import select

from app.services.flight_missions import (
    EXPORT_BUNDLE_FORMAT,
    EXPORT_DJI_FLY_KMZ_FORMAT,
    EXPORT_DJI_WPML_FORMAT,
    _segment_points,
    estimate_mission_duration,
    build_flight_mission_export_bundle,
)
from app.services.planning import get_drone_profile, suggest_spacing_for_profile
from app.services.terrain import TerrainSamplingError


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000 + offset, 59.0000 + offset],
                [10.0014 + offset, 59.0000 + offset],
                [10.0014 + offset, 59.0010 + offset],
                [10.0000 + offset, 59.0010 + offset],
            ]
        ],
    }


def _create_field(client, *, name: str, offset: float = 0.0) -> dict:
    response = client.post(
        "/api/v1/fields",
        json={
            "name": name,
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(offset),
        },
    )
    assert response.status_code == 201
    return response.json()


def _create_additional_property(client, *, label: str = "Leiejord øst", gnr: int = 70, bnr: int = 28) -> dict:
    response = client.patch(
        "/api/v1/profile/current",
        json={
            "additional_properties": [
                {
                    "label": label,
                    "komm": "4003",
                    "gnr": gnr,
                    "bnr": bnr,
                    "fnr": 0,
                }
            ]
        },
    )
    assert response.status_code == 200
    return response.json()["additional_properties"][0]


def test_flight_mission_roundtrip_and_export_bundle(client):
    nord = _create_field(client, name="Nordjordet")
    sor = _create_field(client, name="Sørjordet", offset=0.003)

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Uke 12",
            "field_ids": [nord["id"], sor["id"]],
            "parameters": {
                "altitude_m": 55,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 16,
                "route_angle_deg": 22,
            },
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"] == "Uke 12"
    assert created["field_ids"] == [nord["id"], sor["id"]]
    assert created["status"] == "ready"
    assert len(created["fields"]) == 2
    assert created["route_geojson"]["type"] == "FeatureCollection"
    assert any(feature["geometry"]["type"] == "LineString" for feature in created["route_geojson"]["features"])

    listing = client.get("/api/v1/flight-missions")
    assert listing.status_code == 200
    listed = listing.json()
    assert listed["count"] == 1
    assert listed["missions"][0]["id"] == created["id"]

    update_response = client.patch(
        f"/api/v1/flight-missions/{created['id']}",
        json={
            "name": "Uke 12 oppdatert",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 20,
                "waypoint_spacing_m": 14,
                "route_angle_deg": 45,
            },
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "Uke 12 oppdatert"
    assert updated["parameters"]["route_angle_deg"] == 45

    export_response = client.post(f"/api/v1/flight-missions/{created['id']}/export")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == "application/zip"

    archive = zipfile.ZipFile(io.BytesIO(export_response.content))
    assert sorted(archive.namelist()) == [
        "fields.geojson",
        "manifest.json",
        "route.geojson",
        "uke-12-oppdatert.readme.txt",
    ]
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["format"] == EXPORT_BUNDLE_FORMAT
    assert manifest["summary"]["field_count"] == 2
    route_geojson = json.loads(archive.read("route.geojson"))
    assert route_geojson["type"] == "FeatureCollection"
    assert any(feature["geometry"]["type"] == "LineString" for feature in route_geojson["features"])


def test_flight_mission_export_returns_dji_kmz_for_supported_profile(client):
    field = _create_field(client, name="DJI-jordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "DJI eksport",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mavic-3-enterprise",
            "parameters": {
                "altitude_m": 70,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 16,
                "route_angle_deg": 15,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == "application/vnd.google-earth.kmz"
    assert export_response.headers["X-Flyvendebonder-Export-Format"] == EXPORT_DJI_WPML_FORMAT
    assert export_response.headers["Content-Disposition"].endswith('.kmz"')

    archive = zipfile.ZipFile(io.BytesIO(export_response.content))
    assert sorted(archive.namelist()) == ["wpmz/template.kml", "wpmz/waylines.wpml"]

    template_root = ET.fromstring(archive.read("wpmz/template.kml"))
    waylines_root = ET.fromstring(archive.read("wpmz/waylines.wpml"))
    namespace = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.2"}

    assert template_root.find("./kml:Document/wpml:missionConfig", namespace) is not None
    assert template_root.find(".//wpml:templateType", namespace).text == "waypoint"
    assert waylines_root.find(".//wpml:executeHeightMode", namespace).text == "relativeToStartPoint"
    assert waylines_root.find(".//wpml:droneEnumValue", namespace).text == "77"
    assert waylines_root.find(".//wpml:payloadEnumValue", namespace).text == "66"
    assert waylines_root.find(".//wpml:actionActuatorFunc", namespace).text == "takePhoto"


def test_flight_mission_export_rejects_strict_dji_wpml_for_unsupported_profile(client):
    field = _create_field(client, name="Mini-jordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Mini eksport",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export?format=dji-wpml")
    assert export_response.status_code == 400
    assert "DJI WPML-eksport støttes foreløpig ikke" in export_response.json()["detail"]


def test_flight_mission_export_auto_returns_dji_fly_kmz_for_mini_4_pro(client):
    field = _create_field(client, name="Mini Fly-jordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Mini Fly eksport",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == "application/vnd.google-earth.kmz"
    assert export_response.headers["X-Flyvendebonder-Export-Format"] == EXPORT_DJI_FLY_KMZ_FORMAT
    assert export_response.headers["Content-Disposition"].endswith('.kmz"')

    archive = zipfile.ZipFile(io.BytesIO(export_response.content))
    assert sorted(archive.namelist()) == [
        "mini-fly-eksport.readme.txt",
        "wpmz/template.kml",
        "wpmz/waylines.wpml",
    ]

    template_root = ET.fromstring(archive.read("wpmz/template.kml"))
    waylines_root = ET.fromstring(archive.read("wpmz/waylines.wpml"))
    namespace = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.2"}

    assert template_root.find("./kml:Document/wpml:author", namespace).text == "fly"
    assert template_root.find(".//wpml:globalUseStraightLine", namespace).text == "1"
    assert template_root.find(".//wpml:droneEnumValue", namespace).text == "68"
    assert template_root.find(".//wpml:payloadInfo", namespace) is None
    assert template_root.find(".//wpml:actionActuatorFunc", namespace) is None

    assert waylines_root.find(".//wpml:droneEnumValue", namespace).text == "68"
    assert waylines_root.find(".//wpml:executeRCLostAction", namespace).text == "goBack"
    assert waylines_root.find(".//wpml:exitOnRCLost", namespace).text == "executeLostAction"
    assert waylines_root.find(".//wpml:distance", namespace) is not None
    assert waylines_root.find(".//wpml:duration", namespace) is not None
    assert waylines_root.find(".//wpml:payloadInfo", namespace) is None
    assert waylines_root.find(".//wpml:actionActuatorFunc", namespace) is None

    readme = archive.read("mini-fly-eksport.readme.txt").decode("utf-8")
    assert "DJI Fly / Mini 4 Pro" in readme
    assert "midlertidig waypoint-rute i DJI Fly" in readme


def test_flight_mission_export_supports_strict_dji_fly_for_mini_4_pro(client):
    field = _create_field(client, name="Mini strict-jordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Mini strict eksport",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export?format=dji-fly")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"] == "application/vnd.google-earth.kmz"
    assert export_response.headers["X-Flyvendebonder-Export-Format"] == EXPORT_DJI_FLY_KMZ_FORMAT


def test_flight_mission_preview_dem_agl_uses_launch_point_as_terrain_reference(client, monkeypatch):
    field = _create_field(client, name="Terrengjordet")

    def fake_samples(points):
        values = []
        for point in points:
            if abs(point["lat"] - 59.0001) < 0.000001 and abs(point["lng"] - 9.9999) < 0.000001:
                values.append(100.0)
            else:
                values.append(100.0 + ((point["lng"] - 10.0) * 10_000))
        return values

    monkeypatch.setattr("app.services.flight_missions.sample_terrain_elevations", fake_samples)

    preview_response = client.post(
        "/api/v1/flight-missions/preview",
        json={
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "terrain_mode": "dem_agl",
                "altitude_m": 45,
                "route_angle_deg": 0,
                "launch_point": {"lat": 59.0001, "lng": 9.9999},
            },
        },
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    terrain = preview["export_manifest"]["terrain"]
    assert terrain["terrain_mode"] == "dem_agl"
    assert terrain["takeoff_reference_elevation_m"] == 100.0
    assert terrain["min_relative_waypoint_height_m"] < terrain["max_relative_waypoint_height_m"]
    assert any(feature["properties"].get("kind") == "transit" for feature in preview["route_geojson"]["features"])


def test_flight_mission_export_writes_terrain_corrected_relative_heights(client, monkeypatch):
    field = _create_field(client, name="Terrengeksport")

    def fake_samples(points):
        return [120.0 + (index * 0.8) for index, _ in enumerate(points)]

    monkeypatch.setattr("app.services.flight_missions.sample_terrain_elevations", fake_samples)

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Terreng eksport",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "terrain_mode": "dem_agl",
                "altitude_m": 45,
                "route_angle_deg": 0,
                "launch_point": {"lat": 59.0001, "lng": 9.9999},
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()
    terrain = mission["export_manifest"]["terrain"]
    assert terrain["terrain_mode"] == "dem_agl"

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export?format=dji-fly")
    assert export_response.status_code == 200

    archive = zipfile.ZipFile(io.BytesIO(export_response.content))
    waylines_root = ET.fromstring(archive.read("wpmz/waylines.wpml"))
    namespace = {"kml": "http://www.opengis.net/kml/2.2", "wpml": "http://www.dji.com/wpmz/1.0.2"}
    heights = [float(node.text) for node in waylines_root.findall(".//wpml:executeHeight", namespace)]
    assert len(heights) > 1
    assert max(heights) > min(heights)


def test_flight_mission_preview_dem_agl_falls_back_to_flat_when_terrain_sampling_fails(client, monkeypatch):
    field = _create_field(client, name="Fallbackjordet")

    def failing_samples(_points):
        raise TerrainSamplingError("boom")

    monkeypatch.setattr("app.services.flight_missions.sample_terrain_elevations", failing_samples)

    preview_response = client.post(
        "/api/v1/flight-missions/preview",
        json={
            "field_ids": [field["id"]],
            "parameters": {
                "terrain_mode": "dem_agl",
                "altitude_m": 45,
                "route_angle_deg": 0,
            },
        },
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    terrain = preview["export_manifest"]["terrain"]
    assert terrain["terrain_mode"] == "flat"
    assert terrain["requested_terrain_mode"] == "dem_agl"
    assert any(warning["code"] == "terrain_data_unavailable_fallback_flat" for warning in preview["warnings"])


def test_flight_mission_can_be_deleted(client):
    field = _create_field(client, name="Slettejordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Oppdrag som slettes",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    delete_response = client.delete(f"/api/v1/flight-missions/{mission['id']}")
    assert delete_response.status_code == 204

    fetch_response = client.get(f"/api/v1/flight-missions/{mission['id']}")
    assert fetch_response.status_code == 404


def test_build_flight_mission_export_bundle_rejects_manifest_field_count_mismatch():
    with pytest.raises(ValueError, match="Eksportmanifest og jorddata er ute av synk"):
        build_flight_mission_export_bundle(
            mission_id=1,
            mission_name="Valideringstest",
            fields=[
                {
                    "field_id": 10,
                    "name": "Nordjordet",
                    "area_m2": 1000.0,
                    "area_ha": 0.1,
                    "geometry": {
                        "type": "Polygon",
                        "coordinates": [[
                            [10.0, 59.0],
                            [10.001, 59.0],
                            [10.001, 59.001],
                            [10.0, 59.001],
                            [10.0, 59.0],
                        ]],
                    },
                }
            ],
            route_geojson={
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"kind": "route"},
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[10.0, 59.0], [10.001, 59.001]],
                        },
                    }
                ],
            },
            export_manifest={
                "format": EXPORT_BUNDLE_FORMAT,
                "mission_name": "Valideringstest",
                "summary": {"field_count": 0},
            },
        )


def test_flight_mission_export_returns_400_when_route_snapshot_is_invalid(client):
    field = _create_field(client, name="Nordjordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Korrupt eksport",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    from app.database import SessionLocal
    from app.models import FlightMission

    with SessionLocal() as db:
        item = db.execute(select(FlightMission).where(FlightMission.id == mission["id"])).scalar_one()
        item.route_geojson_json = json.dumps({"type": "FeatureCollection", "features": []}, ensure_ascii=False)
        db.commit()

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export")

    assert export_response.status_code == 400
    assert export_response.json()["detail"] == "Oppdraget kan ikke eksporteres: Eksporten mangler minst én rute-linje"


def test_flight_mission_returns_warning_for_outside_recommended_altitude(client):
    field = _create_field(client, name="Brattjordet")

    response = client.post(
        "/api/v1/flight-missions",
        json={
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 150,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )

    assert response.status_code == 201
    warnings = response.json()["warnings"]
    assert any(item["code"] == "altitude_outside_recommended" for item in warnings)


def test_flight_mission_patch_preserves_existing_parameters_when_partial(client):
    field = _create_field(client, name="Vestjordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Parametertest",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 21,
                "waypoint_spacing_m": 13,
                "route_angle_deg": 37,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    patch_response = client.patch(
        f"/api/v1/flight-missions/{mission['id']}",
        json={
            "parameters": {
                "altitude_m": 62,
            },
        },
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["parameters"]["altitude_m"] == 62
    assert patched["parameters"]["line_spacing_m"] == 21
    assert patched["parameters"]["waypoint_spacing_m"] == 13
    assert patched["parameters"]["route_angle_deg"] == 37


def test_segment_points_respects_waypoint_spacing_ceiling():
    points = _segment_points(0.0, 30.0, 0.0, 18.0)

    assert points == [[0.0, 0.0], [15.0, 0.0], [30.0, 0.0]]


def test_flight_mission_rejects_unknown_field_ids(client):
    response = client.post(
        "/api/v1/flight-missions",
        json={
            "field_ids": [9999],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )

    assert response.status_code == 400
    assert "Fant ikke valgte jorder" in response.json()["detail"]


def test_flight_mission_route_geojson_export(client):
    field = _create_field(client, name="Geojsonjordet")

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "GeoJSON test",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()

    export_response = client.get(f"/api/v1/flight-missions/{mission['id']}/route.geojson")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("application/geo+json")
    payload = export_response.json()
    assert payload["type"] == "FeatureCollection"
    assert payload["flyvendebonder_contract"]["name"] == "flyvendebonder.geojson"
    assert payload["flyvendebonder_contract"]["version"] == "v1"
    assert payload["mission"]["id"] == mission["id"]
    assert any(feature["geometry"]["type"] == "LineString" for feature in payload["features"])


def test_flight_mission_can_be_created_and_loaded_for_additional_property(client):
    extra_property = _create_additional_property(client, gnr=70, bnr=28)
    field = client.post(
        "/api/v1/fields",
        json={
            "property_id": extra_property["id"],
            "name": "Leiejord 70/28",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(0.03),
        },
    )
    assert field.status_code == 201
    created_field = field.json()

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "property_id": extra_property["id"],
            "name": "70/28 plan",
            "field_ids": [created_field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    mission = create_response.json()
    assert mission["property_id"] == extra_property["id"]

    fetch_response = client.get(f"/api/v1/flight-missions/{mission['id']}")
    assert fetch_response.status_code == 200
    assert fetch_response.json()["property_id"] == extra_property["id"]

    export_response = client.post(f"/api/v1/flight-missions/{mission['id']}/export")
    assert export_response.status_code == 200


def test_spacing_recommendation_scales_with_altitude():
    profile = get_drone_profile("dji-mini-4-pro")
    assert profile is not None

    low = suggest_spacing_for_profile(profile, altitude_m=45, camera_preset_id="mini4-12mp")
    high = suggest_spacing_for_profile(profile, altitude_m=120, camera_preset_id="mini4-12mp")

    assert low is not None
    assert high is not None
    assert high["line_spacing_m"] > low["line_spacing_m"]
    assert high["waypoint_spacing_m"] > low["waypoint_spacing_m"]
    assert high["gsd_width_cm"] > low["gsd_width_cm"]


def test_spacing_recommendation_uses_effective_altitude():
    profile = get_drone_profile("dji-mini-4-pro")
    assert profile is not None

    base = suggest_spacing_for_profile(profile, altitude_m=100, camera_preset_id="mini4-12mp", ground_offset_m=0)
    offset = suggest_spacing_for_profile(profile, altitude_m=100, camera_preset_id="mini4-12mp", ground_offset_m=15)

    assert base is not None
    assert offset is not None
    assert offset["effective_altitude_m"] == 85.0
    assert offset["line_spacing_m"] < base["line_spacing_m"]
    assert offset["waypoint_spacing_m"] < base["waypoint_spacing_m"]


def test_spacing_recommendation_includes_capture_speed():
    profile = get_drone_profile("dji-mini-4-pro")
    assert profile is not None

    low = suggest_spacing_for_profile(profile, altitude_m=20, camera_preset_id="mini4-12mp")
    high = suggest_spacing_for_profile(profile, altitude_m=100, camera_preset_id="mini4-12mp")

    assert low is not None
    assert high is not None
    assert low["capture_interval_s"] == 2.0
    assert low["max_mapping_speed_mps"] == 11.5
    assert high["recommended_ground_speed_mps"] > low["recommended_ground_speed_mps"]


def test_estimated_duration_uses_capture_limited_speed():
    profile = get_drone_profile("dji-mini-4-pro")
    assert profile is not None
    recommended_spacing = suggest_spacing_for_profile(profile, altitude_m=20, camera_preset_id="mini4-12mp")
    assert recommended_spacing is not None
    assert recommended_spacing["recommended_ground_speed_mps"] < profile["cruise_speed_mps"]

    duration = estimate_mission_duration(
        route_distance_m=1000,
        waypoint_count=10,
        drone_profile=profile,
        recommended_spacing=recommended_spacing,
    )

    assert duration is not None
    baseline_duration = round((1000 / profile["cruise_speed_mps"]) + profile["launch_overhead_s"] + profile["waypoint_turn_overhead_s"] * 9, 1)
    assert duration > baseline_duration


def test_flight_mission_uses_profile_spacing_instead_of_manual_values(client):
    field = _create_field(client, name="Autospacing-jordet")
    profile = get_drone_profile("dji-mini-4-pro")
    assert profile is not None
    suggested = suggest_spacing_for_profile(profile, altitude_m=100, camera_preset_id="mini4-12mp")
    assert suggested is not None

    response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Autospacing",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 100,
                "camera_preset_id": "mini4-12mp",
                "line_spacing_m": 4,
                "waypoint_spacing_m": 4,
                "route_angle_deg": 0,
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["parameters"]["line_spacing_m"] == suggested["line_spacing_m"]
    assert payload["parameters"]["waypoint_spacing_m"] == suggested["waypoint_spacing_m"]
    assert payload["parameters"]["camera_preset_id"] == "mini4-12mp"
    assert payload["export_manifest"]["summary"]["recommended_ground_speed_mps"] == suggested["recommended_ground_speed_mps"]


def test_flight_mission_supports_launch_landing_and_no_go_buffers(client):
    field = _create_field(client, name="Bufferjordet")

    response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Bufferplan",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
                "launch_point": {"lat": 59.0002, "lng": 10.0002},
                "landing_point": {"lat": 59.0003, "lng": 10.0011},
                "no_go_buffers": [
                    {
                        "id": "mast-1",
                        "name": "Strømsone",
                        "center": {"lat": 59.0005, "lng": 10.0007},
                        "width_m": 36,
                        "height_m": 24,
                    }
                ],
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    feature_kinds = [feature["properties"]["kind"] for feature in payload["route_geojson"]["features"]]
    assert "launch_point" in feature_kinds
    assert "landing_point" in feature_kinds
    assert "no_go_buffer" in feature_kinds
    assert "transit" in feature_kinds
    assert payload["parameters"]["launch_point"]["lat"] == 59.0002
    assert payload["parameters"]["landing_point"]["lng"] == 10.0011
    assert len(payload["parameters"]["no_go_buffers"]) == 1
    assert payload["parameters"]["no_go_buffers"][0]["width_m"] == 36
    assert payload["parameters"]["no_go_buffers"][0]["height_m"] == 24
    assert any(item["code"] == "no_go_buffers_applied" for item in payload["warnings"])
    no_go_polygon = shape(
        next(feature["geometry"] for feature in payload["route_geojson"]["features"] if feature["properties"]["kind"] == "no_go_buffer")
    )
    route_lines = [
        shape(feature["geometry"])
        for feature in payload["route_geojson"]["features"]
        if feature["properties"]["kind"] in {"route", "transit"}
    ]
    assert not any(
        line.crosses(no_go_polygon) or (line.intersects(no_go_polygon) and not line.touches(no_go_polygon))
        for line in route_lines
    )


def test_launch_point_influences_route_direction(client):
    field = _create_field(client, name="Startoptimalisering")

    response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Startoptimalisering",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
                "launch_point": {"lat": 59.00095, "lng": 10.00125},
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    route_line = next(
        feature["geometry"]["coordinates"]
        for feature in payload["route_geojson"]["features"]
        if feature["properties"]["kind"] == "route"
    )
    launch_point = payload["parameters"]["launch_point"]
    first_distance = _distance_to_point(launch_point, route_line[0])
    last_distance = _distance_to_point(launch_point, route_line[-1])
    assert first_distance <= last_distance


def test_launch_point_can_start_route_from_top_edge(client):
    field = _create_field(client, name="Toppstart")

    response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Toppstart",
            "field_ids": [field["id"]],
            "drone_profile_id": "dji-mini-4-pro",
            "parameters": {
                "altitude_m": 60,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
                "launch_point": {"lat": 59.00105, "lng": 9.99995},
            },
        },
    )

    assert response.status_code == 201
    payload = response.json()
    route_line = next(
        feature["geometry"]["coordinates"]
        for feature in payload["route_geojson"]["features"]
        if feature["properties"]["kind"] == "route"
    )
    first_point = route_line[0]
    assert first_point[1] > 59.0005


def _distance_to_point(point: dict[str, float], coordinate: list[float]) -> float:
    return abs(point["lat"] - coordinate[1]) + abs(point["lng"] - coordinate[0])
