from __future__ import annotations

from datetime import datetime


def _disable_candidate_import(monkeypatch) -> None:
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(_property_obj):
        return []

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)


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


def _create_field(
    client,
    *,
    name: str,
    status: str = "confirmed",
    offset: float = 0.0,
    source: str = "manual",
    source_provenance: dict | None = None,
) -> dict:
    response = client.post(
        "/api/v1/fields",
        json={
            "name": name,
            "source": source,
            "status": status,
            "geometry": _sample_polygon(offset),
            "source_provenance": source_provenance or {},
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


def test_planning_sync_creates_units_for_draft_and_confirmed_fields_and_is_idempotent(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
    confirmed = _create_field(client, name="Nordjordet", status="confirmed")
    draft = _create_field(client, name="Utkastjord", status="draft", offset=0.01)

    sync_one = client.post("/api/v1/planning/properties/1/sync")
    assert sync_one.status_code == 200
    payload_one = sync_one.json()
    assert payload_one["created_count"] == 2
    assert payload_one["count"] == 2
    assert {item["source_field_plot_id"] for item in payload_one["units"]} == {confirmed["id"], draft["id"]}
    assert {item["source_field_status"] for item in payload_one["units"]} == {"draft", "confirmed"}

    sync_two = client.post("/api/v1/planning/properties/1/sync")
    assert sync_two.status_code == 200
    payload_two = sync_two.json()
    assert payload_two["created_count"] == 0
    assert payload_two["count"] == 2


def test_planning_sync_refreshes_root_unit_geometry_after_field_edit(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
    created = _create_field(client, name="Nordjordet", status="confirmed")

    sync_one = client.post("/api/v1/planning/properties/1/sync")
    assert sync_one.status_code == 200
    unit_before = sync_one.json()["units"][0]

    updated_geometry = _sample_polygon(0.02)
    patch_response = client.patch(
        f"/api/v1/fields/{created['id']}",
        json={
            "geometry": updated_geometry,
            "status": "confirmed",
        },
    )
    assert patch_response.status_code == 200
    updated_field = patch_response.json()

    sync_two = client.post("/api/v1/planning/properties/1/sync")
    assert sync_two.status_code == 200
    unit_after = sync_two.json()["units"][0]

    assert unit_after["id"] == unit_before["id"]
    assert unit_after["geometry"] == updated_field["geometry"]


def test_patch_field_updates_active_root_planning_unit_geometry_without_resync(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
    created = _create_field(client, name="Direkteoppdatert", status="confirmed")

    sync_response = client.post("/api/v1/planning/properties/1/sync")
    assert sync_response.status_code == 200
    unit_before = sync_response.json()["units"][0]

    updated_geometry = _sample_polygon(0.03)
    patch_response = client.patch(
        f"/api/v1/fields/{created['id']}",
        json={
            "geometry": updated_geometry,
            "status": "confirmed",
        },
    )
    assert patch_response.status_code == 200
    updated_field = patch_response.json()

    units_response = client.get("/api/v1/planning/properties/1/units")
    assert units_response.status_code == 200
    unit_after = units_response.json()["units"][0]

    assert unit_after["id"] == unit_before["id"]
    assert unit_after["geometry"] == updated_field["geometry"]


def test_planning_sync_imports_owned_fields_from_geonorge_when_none_exist(client, monkeypatch):
    import app.api.v1 as v1
    fetched_at = datetime(2026, 6, 21, 9, 0, 0)

    async def fake_list_field_candidates_for_property(property_obj):
        return [
            {
                "source": "geonorge",
                "source_endpoint": "/geokoding",
                "source_fetched_at": fetched_at,
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
                "source_updated_at": datetime(2024, 1, 1, 0, 0, 0),
            }
        ]

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)

    sync_response = client.post("/api/v1/planning/properties/1/sync")
    assert sync_response.status_code == 200
    payload = sync_response.json()
    assert payload["created_count"] == 1
    assert payload["count"] == 1
    assert payload["units"][0]["name"] == "70/17 · hovedteig"
    assert payload["units"][0]["source_field_source"] == "imported"
    assert payload["units"][0]["source_field_provenance"]["source"] == "geonorge"
    assert payload["units"][0]["source_field_provenance"]["source_endpoint"] == "/geokoding"
    assert payload["units"][0]["source_field_provenance"]["accuracy_class"] == "Gult"

    fields_response = client.get("/api/v1/fields")
    assert fields_response.status_code == 200
    fields_payload = fields_response.json()
    assert fields_payload["count"] == 1
    assert fields_payload["fields"][0]["source"] == "imported"
    assert fields_payload["fields"][0]["status"] == "draft"
    assert fields_payload["fields"][0]["source_provenance"]["matrikkelnummer"] == "70/17"
    assert payload["units"][0]["source_field_status"] == "draft"


def test_deleting_field_also_removes_planning_units(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
    created = _create_field(client, name="Slettejord", status="confirmed")

    sync_response = client.post("/api/v1/planning/properties/1/sync")
    assert sync_response.status_code == 200
    assert sync_response.json()["count"] == 1

    delete_response = client.delete(f"/api/v1/fields/{created['id']}")
    assert delete_response.status_code == 200

    units_response = client.get("/api/v1/planning/properties/1/units")
    assert units_response.status_code == 200
    assert units_response.json()["count"] == 0


def test_planning_resolve_point_imports_and_reuses_owned_field(client, monkeypatch):
    import app.api.v1 as v1
    fetched_at = datetime(2026, 6, 21, 9, 5, 0)
    current_geometry = _sample_polygon(0.02)

    async def fake_lookup_field_candidates_by_point(property_obj, *, lat, lng, radius_m):
        assert lat == 59.0
        assert lng == 10.0
        assert radius_m == 60
        return [
            {
                "source": "geonorge",
                "source_endpoint": "/punkt/omrader",
                "source_fetched_at": fetched_at,
                "name": f"{property_obj.gnr}/{property_obj.bnr} · teig 1",
                "local_id": 1,
                "matrikkelnummer": f"{property_obj.gnr}/{property_obj.bnr}",
                "object_type": "Teig",
                "accuracy_class": "Gult",
                "is_main_area": False,
                "distance_m": 4,
                "geometry": current_geometry,
                "area_m2": 2400.0,
                "area_ha": 0.24,
                "source_updated_at": datetime(2024, 1, 2, 0, 0, 0),
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
    assert first_payload["unit"]["source_field_status"] == "draft"
    assert first_payload["unit"]["source_field_provenance"]["source"] == "geonorge"
    assert first_payload["unit"]["source_field_provenance"]["source_endpoint"] == "/punkt/omrader"
    assert first_payload["unit"]["source_field_provenance"]["source_key"]

    current_geometry = _sample_polygon(0.021)

    second = client.post(
        "/api/v1/planning/properties/1/resolve-point",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["imported_field"] is False
    assert second_payload["created_unit"] is False
    assert second_payload["unit"]["id"] == first_payload["unit"]["id"]


def test_planning_resolve_point_across_all_owned_properties(client, monkeypatch):
    import app.api.v1 as v1

    extra_property = _create_additional_property(client, gnr=70, bnr=28)

    async def fake_lookup_field_candidates_by_point_any(*, lat, lng, radius_m):
        assert lat == 59.0
        assert lng == 10.0
        assert radius_m == 60
        return [
            {
                "source": "geonorge",
                "name": "70/28 · hovedteig",
                "local_id": 2,
                "matrikkelnummer": "70/28",
                "object_type": "Teig",
                "accuracy_class": "Gult",
                "is_main_area": True,
                "distance_m": 7,
                "geometry": _sample_polygon(0.05),
                "area_m2": 5200.0,
                "area_ha": 0.52,
                "source_updated_at": None,
                "property_ref": {
                    "komm": "4003",
                    "gnr": 70,
                    "bnr": 28,
                    "fnr": 0,
                    "label": "Leiejord 70/28",
                },
            }
        ]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup_field_candidates_by_point_any)

    response = client.post(
        "/api/v1/planning/resolve-point",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["property_id"] == extra_property["id"]
    assert payload["property_created"] is False
    assert payload["candidate_name"] == "70/28 · hovedteig"
    assert payload["unit"]["property_id"] == extra_property["id"]
    assert payload["unit"]["source_field_status"] == "draft"


def test_planning_resolve_point_creates_property_when_parcel_is_not_already_on_profile(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup_field_candidates_by_point_any(*, lat, lng, radius_m):
        assert lat == 59.0
        assert lng == 10.0
        assert radius_m == 60
        return [
            {
                "source": "geonorge",
                "name": "70/28 · hovedteig",
                "local_id": 2,
                "matrikkelnummer": "70/28",
                "object_type": "Teig",
                "accuracy_class": "Gult",
                "is_main_area": True,
                "distance_m": 7,
                "geometry": _sample_polygon(0.05),
                "area_m2": 5200.0,
                "area_ha": 0.52,
                "source_updated_at": None,
                "property_ref": {
                    "komm": "4003",
                    "gnr": 70,
                    "bnr": 28,
                    "fnr": 0,
                    "label": "70/28",
                },
            }
        ]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup_field_candidates_by_point_any)

    response = client.post(
        "/api/v1/planning/resolve-point",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["property_created"] is True
    assert payload["candidate_name"] == "70/28 · hovedteig"
    assert payload["matrikkelnummer"] == "70/28"
    assert payload["unit"]["source_field_status"] == "draft"

    profile_response = client.get("/api/v1/profile/current")
    assert profile_response.status_code == 200
    additional = profile_response.json()["additional_properties"]
    assert any(item["gnr"] == 70 and item["bnr"] == 28 for item in additional)


def test_planning_split_archives_parent_and_creates_two_children(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
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


def test_flight_mission_preview_and_create_from_planning_units_with_drone_profile(client, monkeypatch):
    _disable_candidate_import(monkeypatch)
    _create_field(
        client,
        name="Vestjordet",
        status="confirmed",
        source="imported",
        source_provenance={
            "source": "geonorge",
            "source_endpoint": "/geokoding",
            "accuracy_class": "Gult",
            "source_updated_at": "2024-01-01T00:00:00",
        },
    )
    sync_response = client.post("/api/v1/planning/properties/1/sync")
    unit = sync_response.json()["units"][0]

    profiles_response = client.get("/api/v1/drone-profiles")
    assert profiles_response.status_code == 200
    profile = profiles_response.json()["profiles"][0]
    profile_id = profile["id"]
    assert profile["camera_presets"]
    assert profile["default_camera_preset_id"] == "mini4-12mp"
    assert {preset["id"] for preset in profile["camera_presets"]} >= {"mini4-12mp", "mini4-48mp"}
    assert profile["capture_interval_s"] == 2.0
    assert profile["max_mapping_speed_mps"] == 11.5

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
    assert preview["fields"][0]["source"] == "imported"
    assert preview["fields"][0]["source_provenance"]["source"] == "geonorge"

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
    assert created["fields"][0]["source_provenance"]["accuracy_class"] == "Gult"
