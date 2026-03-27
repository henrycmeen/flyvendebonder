from __future__ import annotations


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


def test_flight_capture_roundtrip_with_mission(client):
    field = _create_field(client, name="Capturejordet")
    mission_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Mission for capture",
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

    create_response = client.post(
        "/api/v1/flight-captures",
        json={
            "mission_id": mission["id"],
            "photo_ids": [
                "smoke-2025-07-18-00",
                "smoke-2025-07-18-01",
                "smoke-2025-07-18-02",
            ],
            "notes": "Første samlet capture for processing",
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["mission_id"] == mission["id"]
    assert created["source"] == "mission"
    assert created["photo_count"] == 3
    assert created["field_ids"] == [field["id"]]
    assert created["captured_from"] is not None
    assert created["captured_to"] is not None

    get_response = client.get(f"/api/v1/flight-captures/{created['id']}")
    assert get_response.status_code == 200
    fetched = get_response.json()
    assert fetched["id"] == created["id"]
    assert fetched["processing_run_count"] == 0

    list_response = client.get("/api/v1/flight-captures")
    assert list_response.status_code == 200
    listing = list_response.json()
    assert listing["count"] == 1
    assert listing["captures"][0]["id"] == created["id"]


def test_processing_run_and_artifact_lifecycle(client):
    capture_response = client.post(
        "/api/v1/flight-captures",
        json={
            "name": "Smoke capture",
            "photo_ids": [
                "smoke-2025-07-18-00",
                "smoke-2025-07-18-01",
            ],
            "source": "imported",
        },
    )
    assert capture_response.status_code == 201
    capture = capture_response.json()

    run_response = client.post(
        "/api/v1/processing-runs",
        json={
            "capture_id": capture["id"],
            "provider": "webodm",
            "requested_outputs": ["ortho", "dsm", "thumb"],
            "provider_config": {"fast_orthophoto": True},
        },
    )
    assert run_response.status_code == 201
    run = run_response.json()
    assert run["status"] == "queued"
    assert run["input_manifest"]["capture_id"] == capture["id"]
    assert run["input_manifest"]["photo_count"] == 2
    assert run["requested_outputs"] == ["ortho", "dsm", "thumb"]

    patch_response = client.patch(
        f"/api/v1/processing-runs/{run['id']}",
        json={
            "status": "completed",
            "external_job_id": "webodm-job-42",
        },
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["status"] == "completed"
    assert patched["external_job_id"] == "webodm-job-42"
    assert patched["started_at"] is not None
    assert patched["finished_at"] is not None

    artifact_response = client.post(
        f"/api/v1/processing-runs/{run['id']}/artifacts",
        json={
            "kind": "ortho",
            "format": "cog",
            "uri": "processing/ortho/capture-1.tif",
            "bytes": 2048,
            "checksum": "sha256:demo",
            "is_public": False,
            "metadata": {"epsg": "EPSG:25833"},
            "provenance": {"provider": "webodm", "source_run_status": "completed"},
        },
    )
    assert artifact_response.status_code == 201
    artifact = artifact_response.json()
    assert artifact["kind"] == "ortho"
    assert artifact["metadata"]["epsg"] == "EPSG:25833"
    assert artifact["provenance"]["provider"] == "webodm"
    assert artifact["public_url"] is None

    list_response = client.get(f"/api/v1/processing-runs/{run['id']}/artifacts")
    assert list_response.status_code == 200
    listing = list_response.json()
    assert listing["count"] == 1
    assert listing["artifacts"][0]["id"] == artifact["id"]

    all_runs = client.get("/api/v1/processing-runs")
    assert all_runs.status_code == 200
    runs = all_runs.json()
    assert runs["count"] == 1
    assert runs["runs"][0]["artifact_count"] == 1


def test_processing_artifact_rejects_unknown_kind(client):
    capture_response = client.post(
        "/api/v1/flight-captures",
        json={
            "name": "Invalid artifact capture",
            "photo_ids": ["smoke-2025-07-18-00"],
        },
    )
    assert capture_response.status_code == 201
    capture = capture_response.json()

    run_response = client.post(
        "/api/v1/processing-runs",
        json={
            "capture_id": capture["id"],
            "provider": "webodm",
            "requested_outputs": ["ortho"],
        },
    )
    assert run_response.status_code == 201
    run = run_response.json()

    artifact_response = client.post(
        f"/api/v1/processing-runs/{run['id']}/artifacts",
        json={
            "kind": "unknown",
            "format": "cog",
            "uri": "processing/unknown.bin",
        },
    )
    assert artifact_response.status_code == 422
