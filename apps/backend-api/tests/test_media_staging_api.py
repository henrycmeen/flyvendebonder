from __future__ import annotations

from datetime import datetime


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
