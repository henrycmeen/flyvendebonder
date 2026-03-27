from __future__ import annotations

import json


def _create_video_job(
    client,
    *,
    filename: str = "feltflyvning.mp4",
    mode: str = "frames",
    config: dict | None = None,
) -> dict:
    payload_config = config or {
        "process": mode,
        "interval_seconds": 4.0,
        "duration_seconds": 45.0,
        "fps": 2,
        "route_points": [
            {"lat": 59.1200, "lng": 9.9800},
            {"lat": 59.1204, "lng": 9.9812},
            {"lat": 59.1211, "lng": 9.9824},
        ],
        "map_display_mode": "overlay_existing",
    }
    response = client.post(
        "/api/v1/video-jobs",
        files={"file": (filename, b"fake-video-binary", "video/mp4")},
        data={
            "mode": mode,
            "config": json.dumps(payload_config),
        },
    )
    assert response.status_code == 201
    payload = response.json()
    assert "job" in payload
    return payload["job"]


def test_video_job_roundtrip_and_artifacts(client):
    job = _create_video_job(client)
    job_id = job["job_id"]

    assert job["mode"] == "frames"
    assert job["status"] == "done"
    assert job["result_frames"]["frame_count"] == 90
    assert len(job["result_frames"]["sample_frames"]) == 12
    assert job["result"]["selected_frame_count"] == 12
    assert job["result_map3d"]["preview_image"] == f"/api/v1/video-jobs/{job_id}/preview.jpg"
    assert job["result_map3d"]["geodata_geojson"] == f"/api/v1/video-jobs/{job_id}/geodata.geojson"
    assert job["result_map3d"]["metadata_json"] == f"/api/v1/video-jobs/{job_id}/metadata.json"

    get_response = client.get(f"/api/v1/video-jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()["job"]
    assert fetched["job_id"] == job_id
    assert fetched["result_frames"]["route_distance_m"] == 185.0
    assert fetched["result_frames"]["step_distance_m"] == 16.8
    assert fetched["result_map3d"]["stitch_job_id"] == job_id
    assert fetched["result_map3d"]["epsg"] == "EPSG:4326"

    preview_response = client.get(f"/api/v1/video-jobs/{job_id}/preview.jpg")
    assert preview_response.status_code == 200
    assert preview_response.headers["content-type"] == "image/jpeg"
    assert len(preview_response.content) > 100

    geodata_response = client.get(f"/api/v1/video-jobs/{job_id}/geodata.geojson")
    assert geodata_response.status_code == 200
    assert geodata_response.headers["content-type"].startswith("application/geo+json")
    geodata = geodata_response.json()
    assert geodata["type"] == "FeatureCollection"
    assert geodata["features"][0]["geometry"]["type"] == "LineString"
    assert geodata["features"][0]["properties"]["route_distance_m"] == 185.0
    assert len(geodata["features"]) == 13

    metadata_response = client.get(f"/api/v1/video-jobs/{job_id}/metadata.json")
    assert metadata_response.status_code == 200
    metadata = metadata_response.json()
    assert metadata["job_id"] == job_id
    assert metadata["provider"] == "video_contract_v2"
    assert metadata["is_placeholder"] is False
    assert metadata["result_frames"]["selected_frame_count"] == 12


def test_video_job_respects_route_and_interval_config(client):
    job = _create_video_job(
        client,
        filename="rute.mp4",
        config={
            "process": "frames",
            "fps": 4,
            "duration_seconds": 20.0,
            "interval_seconds": 5.0,
            "route_points": [
                {"lat": 59.2000, "lng": 10.1000},
                {"lat": 59.2010, "lng": 10.1015},
            ],
        },
    )

    assert job["result_frames"]["frame_count"] == 80
    assert job["result_frames"]["selected_frame_count"] == 5
    assert job["result_frames"]["route_distance_m"] == 139.7
    assert job["result_frames"]["step_distance_m"] == 34.9
    assert [item["timestamp_ms"] for item in job["result_frames"]["sample_frames"]] == [
        0,
        5063,
        10127,
        15190,
        20000,
    ]


def test_video_job_review_is_persisted(client):
    job = _create_video_job(client)
    job_id = job["job_id"]

    review_response = client.put(
        f"/api/v1/video-jobs/{job_id}/review",
        json={
            "created_at": job["created_at"],
            "mode": "frames",
            "review_state": "placed",
            "placement": {"lat": 59.1234, "lng": 10.4321},
        },
    )
    assert review_response.status_code == 200
    review = review_response.json()
    assert review["job_id"] == job_id
    assert review["review_state"] == "placed"
    assert review["placement"] == {"lat": 59.1234, "lng": 10.4321}

    get_response = client.get(f"/api/v1/video-jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()["job"]
    assert fetched["review"]["review_state"] == "placed"
    assert fetched["review"]["placement"] == {"lat": 59.1234, "lng": 10.4321}


def test_video_job_rejects_invalid_config_payload(client):
    response = client.post(
        "/api/v1/video-jobs",
        files={"file": ("feltflyvning.mp4", b"fake-video-binary", "video/mp4")},
        data={"mode": "frames", "config": "[]"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "config må være et objekt"


def test_video_job_listing_returns_latest_jobs_first_and_can_filter(client):
    first = _create_video_job(client, filename="eldst.mp4", mode="frames")
    second = _create_video_job(client, filename="midten.mp4", mode="map3d")
    third = _create_video_job(client, filename="nyest.mp4", mode="frames")

    list_response = client.get("/api/v1/video-jobs")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["count"] >= 3
    listed_ids = [item["job_id"] for item in payload["jobs"][:3]]
    assert listed_ids == [third["job_id"], second["job_id"], first["job_id"]]

    filtered_response = client.get("/api/v1/video-jobs?mode=frames&limit=10")
    assert filtered_response.status_code == 200
    filtered = filtered_response.json()
    assert filtered["count"] >= 2
    assert all(item["mode"] == "frames" for item in filtered["jobs"])
    assert [item["job_id"] for item in filtered["jobs"][:2]] == [third["job_id"], first["job_id"]]


def test_video_job_endpoints_are_scoped_to_current_user(client):
    from app.config import get_settings
    from app.database import SessionLocal
    from app.models import User
    from app.services.video_jobs import create_video_job
    from sqlalchemy import select

    with SessionLocal() as db:
        other_user = User(
            full_name="Annen Bruker",
            phone="+47 90000000",
            email="annen@example.test",
        )
        db.add(other_user)
        db.commit()
        db.refresh(other_user)

        foreign_job = create_video_job(
            db,
            app_data_root=get_settings().app_data_root,
            user_id=other_user.id,
            property_id=None,
            filename="annen.mp4",
            mode="frames",
            config={"process": "frames"},
        )

    get_response = client.get(f"/api/v1/video-jobs/{foreign_job.id}")
    assert get_response.status_code == 404

    review_response = client.put(
        f"/api/v1/video-jobs/{foreign_job.id}/review",
        json={
            "review_state": "kept",
        },
    )
    assert review_response.status_code == 404

    preview_response = client.get(f"/api/v1/video-jobs/{foreign_job.id}/preview.jpg")
    assert preview_response.status_code == 404
