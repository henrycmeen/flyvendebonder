from __future__ import annotations


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000 + offset, 59.0000 + offset],
                [10.0018 + offset, 59.0000 + offset],
                [10.0018 + offset, 59.0012 + offset],
                [10.0000 + offset, 59.0012 + offset],
            ]
        ],
    }


def _create_field(client, *, name: str, status: str = "confirmed", offset: float = 0.0) -> dict:
    response = client.post(
        "/api/v1/fields",
        json={
            "name": name,
            "source": "manual",
            "status": status,
            "geometry": _sample_polygon(offset),
        },
    )
    assert response.status_code == 201
    return response.json()


def test_planning_sync_creates_units_for_confirmed_fields_only_and_is_idempotent(client):
    confirmed = _create_field(client, name="Nordjordet", status="confirmed")
    _create_field(client, name="Utkastjord", status="draft", offset=0.01)

    sync_one = client.post("/api/v1/planning/properties/1/sync")
    assert sync_one.status_code == 200
    payload_one = sync_one.json()
    assert payload_one["created_count"] == 1
    assert payload_one["count"] == 1
    assert payload_one["units"][0]["source_field_plot_id"] == confirmed["id"]

    sync_two = client.post("/api/v1/planning/properties/1/sync")
    assert sync_two.status_code == 200
    payload_two = sync_two.json()
    assert payload_two["created_count"] == 0
    assert payload_two["count"] == 1


def test_planning_sync_imports_owned_fields_from_geonorge_when_none_exist(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(property_obj):
        return [
            {
                "source": "geonorge",
                "name": f"{property_obj.gnr}/{property_obj.bnr} · hovedteig",
                "local_id": 42465981,
                "matrikkelnummer": f"{property_obj.gnr}/{property_obj.bnr}",
                "object_type": "Teig",
                "accuracy_class": "Gult",
                "is_main_area": True,
                "distance_m": None,
                "geometry": _sample_polygon(),
                "area_m2": 2400.0,
                "area_ha": 0.24,
                "source_updated_at": None,
            }
        ]

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)

    sync_response = client.post("/api/v1/planning/properties/1/sync")
    assert sync_response.status_code == 200
    payload = sync_response.json()
    assert payload["created_count"] == 1
    assert payload["count"] == 1
    assert payload["units"][0]["name"] == "70/17 · hovedteig"

    fields_response = client.get("/api/v1/fields")
    assert fields_response.status_code == 200
    fields_payload = fields_response.json()
    assert fields_payload["count"] == 1
    assert fields_payload["fields"][0]["source"] == "imported"
    assert fields_payload["fields"][0]["status"] == "confirmed"


def test_planning_resolve_point_imports_and_reuses_owned_field(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup_field_candidates_by_point(property_obj, *, lat, lng, radius_m):
        assert lat == 59.0
        assert lng == 10.0
        assert radius_m == 60
        return [
            {
                "source": "geonorge",
                "name": f"{property_obj.gnr}/{property_obj.bnr} · teig 1",
                "local_id": 1,
                "matrikkelnummer": f"{property_obj.gnr}/{property_obj.bnr}",
                "object_type": "Teig",
                "accuracy_class": "Gult",
                "is_main_area": False,
                "distance_m": 4,
                "geometry": _sample_polygon(0.02),
                "area_m2": 2400.0,
                "area_ha": 0.24,
                "source_updated_at": None,
            }
        ]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point", fake_lookup_field_candidates_by_point)

    first = client.post(
        "/api/v1/planning/properties/1/resolve-point",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["imported_field"] is True
    assert first_payload["created_unit"] is True
    assert first_payload["candidate_name"] == "70/17 · teig 1"
    assert first_payload["matrikkelnummer"] == "70/17"

    second = client.post(
        "/api/v1/planning/properties/1/resolve-point",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["imported_field"] is False
    assert second_payload["created_unit"] is False
    assert second_payload["unit"]["id"] == first_payload["unit"]["id"]


def test_planning_split_archives_parent_and_creates_two_children(client):
    _create_field(client, name="Storjordet", status="confirmed")
    sync_response = client.post("/api/v1/planning/properties/1/sync")
    unit = sync_response.json()["units"][0]

    split_response = client.post(
        f"/api/v1/planning/units/{unit['id']}/split",
        json={
            "line": {
                "type": "LineString",
                "coordinates": [[10.0009, 58.9998], [10.0009, 59.0015]],
            }
        },
    )
    assert split_response.status_code == 200
    payload = split_response.json()
    assert payload["archived_unit"]["status"] == "archived"
    assert len(payload["created_units"]) == 2
    assert all(item["status"] == "active" for item in payload["created_units"])
    assert all(item["parent_unit_id"] == unit["id"] for item in payload["created_units"])

    listing = client.get("/api/v1/planning/properties/1/units")
    assert listing.status_code == 200
    listed = listing.json()
    assert listed["count"] == 2
    assert all(item["is_split"] is True for item in listed["units"])


def test_flight_mission_preview_and_create_from_planning_units_with_drone_profile(client):
    _create_field(client, name="Vestjordet", status="confirmed")
    sync_response = client.post("/api/v1/planning/properties/1/sync")
    unit = sync_response.json()["units"][0]

    profiles_response = client.get("/api/v1/drone-profiles")
    assert profiles_response.status_code == 200
    profile_id = profiles_response.json()["profiles"][0]["id"]

    preview_response = client.post(
        "/api/v1/flight-missions/preview",
        json={
            "name": "Planoppdrag",
            "planning_unit_ids": [unit["id"]],
            "drone_profile_id": profile_id,
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()
    assert preview["planning_unit_ids"] == [unit["id"]]
    assert preview["drone_profile_id"] == profile_id
    assert preview["estimated_duration_s"] is not None
    assert preview["duration_status"] in {"ok", "warning", "over_limit"}
    assert preview["fields"][0]["planning_unit_id"] == unit["id"]

    create_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Planoppdrag",
            "planning_unit_ids": [unit["id"]],
            "drone_profile_id": profile_id,
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["planning_unit_ids"] == [unit["id"]]
    assert created["drone_profile_id"] == profile_id
    assert created["estimated_duration_s"] == preview["estimated_duration_s"]
    assert created["fields"][0]["field_id"] == unit["source_field_plot_id"]
    assert created["fields"][0]["planning_unit_id"] == unit["id"]
