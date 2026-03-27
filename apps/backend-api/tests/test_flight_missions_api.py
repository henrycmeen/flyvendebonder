from __future__ import annotations

import io
import json
import zipfile

import pytest
from sqlalchemy import select

from app.services.flight_missions import EXPORT_BUNDLE_FORMAT, _segment_points, build_flight_mission_export_bundle


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
