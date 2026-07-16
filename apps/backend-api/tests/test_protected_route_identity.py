from __future__ import annotations

import ast
from pathlib import Path

from tests.test_admin_access import _create_secondary_owner, _set_bound_admin_session


PROTECTED_ROUTE_HANDLERS = {
    "get_logs",
    "create_field_plot",
    "patch_field_plot",
    "delete_field_plot",
    "export_field_plots_geojson",
    "sync_property_planning_units",
    "create_scouting_task",
    "patch_scouting_task",
    "split_property_planning_unit",
    "confirm_operating_area",
    "resolve_owned_planning_point",
    "resolve_property_planning_point",
    "create_flight_mission",
    "patch_flight_mission",
    "delete_flight_mission",
    "export_flight_mission",
    "export_flight_mission_route_geojson",
    "create_flight_capture",
    "create_processing_run",
    "patch_processing_run",
    "create_processing_artifact",
    "approve_photo_analysis",
    "recompute_photo_analysis",
    "patch_photo_metadata",
    "refresh_analysis",
    "reprocess_photo_metadata",
    "post_import_photos",
    "get_import_run",
    "create_media_staging_job",
    "list_media_staging_jobs",
    "get_media_staging_job",
    "finalize_media_staging_job",
    "create_video_job",
    "list_video_jobs",
    "get_video_job",
    "put_video_job_review",
    "get_video_job_artifact",
    "get_asset",
}


def test_protected_routes_bind_the_request_owner_instead_of_global_pilot() -> None:
    source_path = Path(__file__).resolve().parents[1] / "app" / "api" / "v1.py"
    source = source_path.read_text(encoding="utf-8")
    tree = ast.parse(source)
    functions = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }

    assert PROTECTED_ROUTE_HANDLERS <= functions.keys()
    for name in sorted(PROTECTED_ROUTE_HANDLERS):
        function_source = ast.get_source_segment(source, functions[name]) or ""
        assert "Depends(_request_owner_user)" in function_source, name
        assert "_current_user(" not in function_source, name


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0 + offset, 59.0 + offset],
                [10.0012 + offset, 59.0 + offset],
                [10.0012 + offset, 59.0009 + offset],
                [10.0 + offset, 59.0009 + offset],
            ]
        ],
    }


def _secondary_user_and_property() -> tuple[int, int]:
    from app.database import SessionLocal
    from app.models import Property
    from sqlalchemy import select

    user_id, _membership_id = _create_secondary_owner()
    with SessionLocal() as db:
        property_id = db.execute(
            select(Property.id).where(Property.user_id == user_id)
        ).scalar_one()
    return user_id, property_id


def test_bound_owner_cannot_mutate_another_users_fields(client) -> None:
    from app.database import SessionLocal
    from app.models import Property
    from sqlalchemy import select

    with SessionLocal() as db:
        primary_property_id = db.execute(
            select(Property.id).order_by(Property.id)
        ).scalars().first()
    assert primary_property_id is not None

    primary_field = client.post(
        "/api/v1/fields",
        json={"property_id": primary_property_id, "geometry": _sample_polygon()},
    )
    assert primary_field.status_code == 201

    secondary_user_id, secondary_property_id = _secondary_user_and_property()
    _set_bound_admin_session(client, secondary_user_id)

    foreign_create = client.post(
        "/api/v1/fields",
        json={"property_id": primary_property_id, "geometry": _sample_polygon(0.01)},
    )
    assert foreign_create.status_code == 404

    own_create = client.post(
        "/api/v1/fields",
        json={"property_id": secondary_property_id, "geometry": _sample_polygon(0.02)},
    )
    assert own_create.status_code == 201
    own_field_id = own_create.json()["id"]

    foreign_patch = client.patch(
        f"/api/v1/fields/{primary_field.json()['id']}",
        json={"name": "Skal ikke endres"},
    )
    assert foreign_patch.status_code == 404

    export = client.get("/api/v1/fields/export.geojson")
    assert export.status_code == 200
    assert [feature["properties"]["field_id"] for feature in export.json()["features"]] == [own_field_id]


def test_bound_owner_cannot_mutate_or_fetch_another_users_photo(client) -> None:
    from app.database import SessionLocal
    from app.models import Photo, PhotoAsset
    from sqlalchemy import select

    with SessionLocal() as db:
        photo = db.execute(select(Photo).order_by(Photo.id)).scalars().first()
        assert photo is not None
        asset = db.execute(
            select(PhotoAsset).where(PhotoAsset.photo_id == photo.id).order_by(PhotoAsset.id)
        ).scalars().first()
        assert asset is not None
        primary_user_id = photo.user_id
        photo_id = photo.id
        asset_path = asset.path

    secondary_user_id, _secondary_property_id = _secondary_user_and_property()
    _set_bound_admin_session(client, secondary_user_id)

    assert client.post(f"/api/v1/photos/{photo_id}/approve-analysis").status_code == 404
    assert client.post(f"/api/v1/photos/{photo_id}/recompute-analysis").status_code == 404
    assert client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={"caption": "Skal ikke lagres"},
    ).status_code == 404
    assert client.get(f"/api/v1/assets/{asset_path}").status_code == 404
    assert client.post(f"/api/v1/analysis/refresh?user_id={primary_user_id}").status_code == 403
    assert client.post(f"/api/v1/maintenance/reprocess-photos?user_id={primary_user_id}").status_code == 403


def test_bound_owner_only_lists_own_media_and_video_jobs(client) -> None:
    primary_media = client.post(
        "/api/v1/media-staging-jobs",
        files=[("files", ("primary.jpg", b"primary-image", "image/jpeg"))],
    )
    assert primary_media.status_code == 201
    primary_media_id = primary_media.json()["job"]["job_id"]

    primary_video = client.post(
        "/api/v1/video-jobs",
        files={"file": ("primary.mp4", b"primary-video", "video/mp4")},
        data={"mode": "frames"},
    )
    assert primary_video.status_code == 201
    primary_video_id = primary_video.json()["job"]["job_id"]

    secondary_user_id, _secondary_property_id = _secondary_user_and_property()
    _set_bound_admin_session(client, secondary_user_id)

    media_list = client.get("/api/v1/media-staging-jobs")
    video_list = client.get("/api/v1/video-jobs")
    assert media_list.status_code == 200
    assert video_list.status_code == 200
    assert media_list.json()["jobs"] == []
    assert video_list.json()["jobs"] == []
    assert client.get(f"/api/v1/media-staging-jobs/{primary_media_id}").status_code == 404
    assert client.get(f"/api/v1/video-jobs/{primary_video_id}").status_code == 404
    assert client.get(f"/api/v1/video-jobs/{primary_video_id}/metadata.json").status_code == 404


def test_import_runs_are_owned_by_the_bound_session_user(client, tmp_path) -> None:
    from app.database import SessionLocal
    from app.models import IngestRun, User
    from sqlalchemy import select

    with SessionLocal() as db:
        primary_user_id = db.execute(select(User.id).order_by(User.id)).scalars().first()
        assert primary_user_id is not None
        primary_run = IngestRun(user_id=primary_user_id, source_path="/synthetic/primary")
        db.add(primary_run)
        db.commit()
        primary_run_id = primary_run.id

    secondary_user_id, _secondary_property_id = _secondary_user_and_property()
    _set_bound_admin_session(client, secondary_user_id)
    assert client.get(f"/api/v1/imports/{primary_run_id}").status_code == 404

    empty_source = tmp_path / "empty-import"
    empty_source.mkdir()
    created = client.post(
        "/api/v1/imports/photos",
        json={"source_path": str(empty_source)},
    )
    assert created.status_code == 200
    own_run_id = created.json()["import_run"]["id"]
    assert client.get(f"/api/v1/imports/{own_run_id}").status_code == 200

    with SessionLocal() as db:
        own_run = db.get(IngestRun, own_run_id)
        assert own_run is not None
        assert own_run.user_id == secondary_user_id


def test_bound_owner_cannot_attach_another_users_import_run_to_artifact(client) -> None:
    from datetime import date, datetime

    from app.database import SessionLocal
    from app.models import IngestRun, Photo, User
    from sqlalchemy import select

    with SessionLocal() as db:
        primary_user_id = db.execute(select(User.id).order_by(User.id)).scalars().first()
        assert primary_user_id is not None
        primary_run = IngestRun(user_id=primary_user_id, source_path="/synthetic/primary")
        db.add(primary_run)
        db.commit()
        primary_run_id = primary_run.id

    secondary_user_id, secondary_property_id = _secondary_user_and_property()
    with SessionLocal() as db:
        secondary_photo = Photo(
            id="secondary-artifact-photo",
            user_id=secondary_user_id,
            property_id=secondary_property_id,
            captured_at=datetime(2026, 7, 16, 12, 0),
            captured_date=date(2026, 7, 16),
            lat=59.0,
            lng=10.0,
            source_filename="secondary.jpg",
            source_hash="secondary-artifact-photo-hash",
        )
        db.add(secondary_photo)
        db.commit()
    _set_bound_admin_session(client, secondary_user_id)

    capture = client.post(
        "/api/v1/flight-captures",
        json={"name": "Sekundær capture", "photo_ids": ["secondary-artifact-photo"]},
    )
    assert capture.status_code == 201
    processing_run = client.post(
        "/api/v1/processing-runs",
        json={"capture_id": capture.json()["id"], "provider": "webodm"},
    )
    assert processing_run.status_code == 201

    artifact = client.post(
        f"/api/v1/processing-runs/{processing_run.json()['id']}/artifacts",
        json={
            "kind": "ortho",
            "format": "cog",
            "uri": "processing/secondary.tif",
            "ingest_run_id": primary_run_id,
        },
    )
    assert artifact.status_code == 404
