from __future__ import annotations

from datetime import datetime
from io import BytesIO

from PIL import Image


def _jpeg_bytes() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (120, 80), color=(10, 120, 80)).save(buffer, format="JPEG")
    return buffer.getvalue()


def _install_fake_image_metadata(monkeypatch) -> None:
    from app.services import imports as imports_service
    from app.services.metadata_utils import ExtractedMetadata

    def _fake_extract_metadata(path):
        return ExtractedMetadata(
            source_file=str(path),
            captured_at=datetime(2025, 7, 19, 12, 0, 0),
            gps_latitude=59.1234,
            gps_longitude=10.4321,
            altitude_m=32.0,
            gps_altitude_m=32.0,
            relative_altitude_m=32.0,
            absolute_altitude_m=132.0,
            heading_deg=180.0,
            flight_yaw_degree=180.0,
            flight_pitch_degree=0.0,
            gimbal_pitch_degree=-90.0,
            gimbal_yaw_degree=180.0,
            compass=180.0,
            camera_pitch_degree=-90.0,
            camera_yaw_degree=180.0,
            source="test",
            raw={},
            issues=[],
        )

    monkeypatch.setattr(imports_service, "_extract_metadata", _fake_extract_metadata)


def test_media_staging_job_roundtrip_with_mixed_files(client):
    response = client.post(
        "/api/v1/media-staging-jobs",
        files=[
            ("files", ("felt-01.jpg", b"fake-image-binary", "image/jpeg")),
            ("files", ("felt-02.mp4", b"fake-video-binary", "video/mp4")),
            ("files", ("lesmeg.txt", b"ikke-stottet", "text/plain")),
        ],
    )

    assert response.status_code == 201
    job = response.json()["job"]
    job_id = job["job_id"]

    assert job["source"] == "upload"
    assert job["status"] == "staged"
    assert job["counts"] == {
        "total": 3,
        "image_count": 1,
        "video_count": 1,
        "unknown_count": 1,
        "rejected_count": 1,
    }
    assert [item["media_kind"] for item in job["items"]] == ["image", "video", "unknown"]
    assert job["items"][0]["status"] == "staged"
    assert job["items"][0]["checksum"] is not None
    assert job["items"][2]["status"] == "rejected"
    assert job["items"][2]["error_detail"] == "Ukjent eller ikke-støttet filtype"

    get_response = client.get(f"/api/v1/media-staging-jobs/{job_id}")
    assert get_response.status_code == 200
    fetched = get_response.json()["job"]
    assert fetched["job_id"] == job_id
    assert fetched["counts"] == job["counts"]
    assert [item["filename"] for item in fetched["items"]] == ["felt-01.jpg", "felt-02.mp4", "lesmeg.txt"]


def test_media_staging_job_listing_returns_latest_first(client):
    first = client.post(
        "/api/v1/media-staging-jobs",
        files=[("files", ("eldst.jpg", b"image-a", "image/jpeg"))],
    )
    second = client.post(
        "/api/v1/media-staging-jobs",
        files=[("files", ("midten.mp4", b"video-b", "video/mp4"))],
    )
    third = client.post(
        "/api/v1/media-staging-jobs",
        files=[("files", ("nyest.bin", b"unknown-c", "application/octet-stream"))],
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert third.status_code == 201

    list_response = client.get("/api/v1/media-staging-jobs?limit=10")
    assert list_response.status_code == 200
    payload = list_response.json()
    assert payload["count"] >= 3
    listed_ids = [item["job_id"] for item in payload["jobs"][:3]]
    assert listed_ids == [
        third.json()["job"]["job_id"],
        second.json()["job"]["job_id"],
        first.json()["job"]["job_id"],
    ]


def test_media_staging_job_endpoints_are_scoped_to_current_user(client):
    from app.database import SessionLocal
    from app.models import MediaStagingItem, MediaStagingJob, Property, User
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

        property_obj = db.execute(select(Property).where(Property.user_id == other_user.id)).scalars().first()
        created_at = datetime.utcnow()
        foreign_job = MediaStagingJob(
            id="annen-stagingjobb",
            user_id=other_user.id,
            property_id=property_obj.id if property_obj else None,
            source="upload",
            status="staged",
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(foreign_job)
        db.flush()
        db.add(
            MediaStagingItem(
                job_id=foreign_job.id,
                item_order=0,
                filename="annen.jpg",
                mime="image/jpeg",
                bytes=12,
                checksum="abc123",
                media_kind="image",
                status="staged",
                staged_path="media-staging/annen-stagingjobb/000-annen.jpg",
                created_at=created_at,
                updated_at=created_at,
            )
        )
        db.commit()

    get_response = client.get("/api/v1/media-staging-jobs/annen-stagingjobb")
    assert get_response.status_code == 404


def test_media_staging_job_finalize_materializes_images_and_videos(client, monkeypatch):
    _install_fake_image_metadata(monkeypatch)

    staging_response = client.post(
        "/api/v1/media-staging-jobs",
        files=[
            ("files", ("felt-01.jpg", _jpeg_bytes(), "image/jpeg")),
            ("files", ("felt-02.mp4", b"fake-video-binary", "video/mp4")),
            ("files", ("lesmeg.txt", b"ikke-stottet", "text/plain")),
        ],
    )
    assert staging_response.status_code == 201
    job_id = staging_response.json()["job"]["job_id"]

    finalize_response = client.post(f"/api/v1/media-staging-jobs/{job_id}/finalize")
    assert finalize_response.status_code == 200
    result = finalize_response.json()["result"]
    assert result["job_id"] == job_id
    assert result["status"] == "finalized"
    assert result["import_run_id"] is not None
    assert result["image_imported_count"] == 1
    assert result["video_jobs_created"] == 1
    assert result["rejected_count"] == 1
    assert [item["status"] for item in result["items"]] == ["imported", "created", "rejected"]

    image_result = result["items"][0]
    video_result = result["items"][1]
    rejected_result = result["items"][2]
    assert image_result["photo_id"] is not None
    assert video_result["video_job_id"] is not None
    assert rejected_result["detail"] == "Ukjent eller ikke-støttet filtype"

    photos_response = client.get("/api/v1/photos", params={"date": "2025-07-19", "mode": "day"})
    assert photos_response.status_code == 200
    photos = photos_response.json()["photos"]
    assert any(item["id"] == image_result["photo_id"] for item in photos)

    video_response = client.get(f"/api/v1/video-jobs/{video_result['video_job_id']}")
    assert video_response.status_code == 200
    assert video_response.json()["job"]["filename"] == "felt-02.mp4"

    staging_get = client.get(f"/api/v1/media-staging-jobs/{job_id}")
    assert staging_get.status_code == 200
    assert staging_get.json()["job"]["status"] == "finalized"


def test_media_staging_job_finalize_is_idempotent_for_simple_retry(client, monkeypatch):
    _install_fake_image_metadata(monkeypatch)

    staging_response = client.post(
        "/api/v1/media-staging-jobs",
        files=[
            ("files", ("felt-01.jpg", _jpeg_bytes(), "image/jpeg")),
            ("files", ("felt-02.mp4", b"fake-video-binary", "video/mp4")),
        ],
    )
    assert staging_response.status_code == 201
    job_id = staging_response.json()["job"]["job_id"]

    first = client.post(f"/api/v1/media-staging-jobs/{job_id}/finalize")
    second = client.post(f"/api/v1/media-staging-jobs/{job_id}/finalize")

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json() == first.json()

    jobs_response = client.get("/api/v1/video-jobs?limit=10")
    assert jobs_response.status_code == 200
    assert len([item for item in jobs_response.json()["jobs"] if item["filename"] == "felt-02.mp4"]) == 1


def test_media_staging_finalize_is_scoped_to_current_user(client):
    from app.database import SessionLocal
    from app.models import MediaStagingItem, MediaStagingJob, Property, User
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

        property_obj = db.execute(select(Property).where(Property.user_id == other_user.id)).scalars().first()
        created_at = datetime.utcnow()
        foreign_job = MediaStagingJob(
            id="annen-staging-finalize",
            user_id=other_user.id,
            property_id=property_obj.id if property_obj else None,
            source="upload",
            status="staged",
            finalize_result_json="{}",
            created_at=created_at,
            updated_at=created_at,
        )
        db.add(foreign_job)
        db.flush()
        db.add(
            MediaStagingItem(
                job_id=foreign_job.id,
                item_order=0,
                filename="annen.jpg",
                mime="image/jpeg",
                bytes=12,
                checksum="abc123",
                media_kind="image",
                status="staged",
                staged_path="media-staging/annen-staging-finalize/000-annen.jpg",
                created_at=created_at,
                updated_at=created_at,
            )
        )
        db.commit()

    response = client.post("/api/v1/media-staging-jobs/annen-staging-finalize/finalize")
    assert response.status_code == 404
