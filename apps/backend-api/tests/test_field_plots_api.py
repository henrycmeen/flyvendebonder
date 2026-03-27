from __future__ import annotations


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000 + offset, 59.0000 + offset],
                [10.0012 + offset, 59.0000 + offset],
                [10.0012 + offset, 59.0009 + offset],
                [10.0000 + offset, 59.0009 + offset],
            ]
        ],
    }


def test_field_plots_empty_by_default(client):
    response = client.get("/api/v1/fields")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["fields"] == []


def test_field_plot_roundtrip(client):
    create_response = client.post(
        "/api/v1/fields",
        json={
            "source": "manual",
            "status": "draft",
            "geometry": _sample_polygon(),
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"].startswith("Jordutkast ")
    assert created["status"] == "draft"
    assert created["source"] == "manual"
    assert created["area_m2"] > 0
    assert created["geometry"]["coordinates"][0][0] == created["geometry"]["coordinates"][0][-1]

    listing = client.get("/api/v1/fields")
    assert listing.status_code == 200
    listed = listing.json()
    assert listed["count"] == 1
    assert listed["fields"][0]["id"] == created["id"]

    update_response = client.patch(
        f"/api/v1/fields/{created['id']}",
        json={
            "name": "Nordjordet",
            "status": "confirmed",
            "geometry": _sample_polygon(0.001),
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "Nordjordet"
    assert updated["status"] == "confirmed"
    assert updated["area_m2"] > 0

    delete_response = client.delete(f"/api/v1/fields/{created['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "deleted", "field_id": created["id"]}

    after_delete = client.get("/api/v1/fields")
    assert after_delete.status_code == 200
    assert after_delete.json()["count"] == 0


def test_field_plot_rejects_too_small_polygon(client):
    response = client.post(
        "/api/v1/fields",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [10.0, 59.0],
                        [10.0000001, 59.0],
                        [10.0000001, 59.0000001],
                    ]
                ],
            }
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Polygonet er for lite til å lagres som jordutkast"


def test_field_plot_rejects_invalid_coordinate_range(client):
    response = client.post(
        "/api/v1/fields",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [200.0, 59.0],
                        [10.0012, 59.0],
                        [10.0012, 59.0009],
                    ]
                ],
            }
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Koordinater er utenfor gyldig område"


def test_field_history_summarizes_mission_capture_and_processing(client):
    field_response = client.post(
        "/api/v1/fields",
        json={
            "name": "Historikkjordet",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(),
        },
    )
    assert field_response.status_code == 201
    field = field_response.json()

    mission_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Historikkoppdrag",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert mission_response.status_code == 201
    mission = mission_response.json()

    capture_response = client.post(
        "/api/v1/flight-captures",
        json={
            "mission_id": mission["id"],
            "photo_ids": [
                "smoke-2025-07-18-00",
                "smoke-2025-07-18-01",
            ],
            "notes": "Capture for historikk",
        },
    )
    assert capture_response.status_code == 201
    capture = capture_response.json()

    run_response = client.post(
        "/api/v1/processing-runs",
        json={
            "capture_id": capture["id"],
            "provider": "webodm",
            "requested_outputs": ["ortho", "thumb"],
        },
    )
    assert run_response.status_code == 201
    run = run_response.json()

    patch_response = client.patch(
        f"/api/v1/processing-runs/{run['id']}",
        json={"status": "completed"},
    )
    assert patch_response.status_code == 200

    artifact_response = client.post(
        f"/api/v1/processing-runs/{run['id']}/artifacts",
        json={
            "kind": "ortho",
            "format": "cog",
            "uri": "processing/history/ortho.tif",
            "metadata": {"epsg": "EPSG:25832"},
            "provenance": {"provider": "webodm"},
        },
    )
    assert artifact_response.status_code == 201

    history_response = client.get(f"/api/v1/fields/{field['id']}/history")
    assert history_response.status_code == 200
    history = history_response.json()

    assert history["field"]["id"] == field["id"]
    assert history["mission_count"] == 1
    assert history["capture_count"] == 1
    assert history["processing_run_count"] == 1
    assert history["delivery_count"] == 1
    assert history["entries"][0]["kind"] == "processing_run"
    assert {entry["kind"] for entry in history["entries"]} == {"processing_run", "capture", "mission"}
    assert history["entries"][0]["provider"] == "webodm"
    assert history["entries"][0]["artifact_kinds"] == ["ortho"]
    capture_entry = next(entry for entry in history["entries"] if entry["kind"] == "capture")
    mission_entry = next(entry for entry in history["entries"] if entry["kind"] == "mission")
    assert capture_entry["photo_count"] == 2
    assert mission_entry["mission_id"] == mission["id"]


def test_field_history_returns_empty_entries_for_field_without_activity(client):
    field_response = client.post(
        "/api/v1/fields",
        json={
            "name": "Tomt historikkfelt",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(0.01),
        },
    )
    assert field_response.status_code == 201
    field = field_response.json()

    history_response = client.get(f"/api/v1/fields/{field['id']}/history")
    assert history_response.status_code == 200
    history = history_response.json()
    assert history["mission_count"] == 0
    assert history["capture_count"] == 0
    assert history["processing_run_count"] == 0
    assert history["delivery_count"] == 0
    assert history["entries"] == []
