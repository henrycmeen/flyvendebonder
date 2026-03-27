from __future__ import annotations

import json


def _create_video_job(client) -> dict:
    response = client.post(
        "/api/v1/video-jobs",
        files={"file": ("feltflyvning.mp4", b"fake-video-binary", "video/mp4")},
        data={
            "mode": "frames",
            "config": json.dumps(
                {
                    "process": "frames",
                    "interval_seconds": 4.0,
                    "map_display_mode": "overlay_existing",
                }
            ),
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
    assert len(job["result_frames"]["sample_frames"]) == 3
    assert job["result"]["selected_frame_count"] == 3

    get_response = client.get(f"/api/v1/video-jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()["job"]
    assert fetched["job_id"] == job_id
    assert fetched["result_frames"]["route_distance_m"] == 215.0

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

    metadata_response = client.get(f"/api/v1/video-jobs/{job_id}/metadata.json")
    assert metadata_response.status_code == 200
    metadata = metadata_response.json()
    assert metadata["job_id"] == job_id
    assert metadata["provider"] == "video_contract_v1"
    assert metadata["is_placeholder"] is True


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
