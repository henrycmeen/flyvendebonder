from __future__ import annotations

from datetime import datetime

import pytest
from PIL import Image


def test_photo_import_exposes_provenance_fields(client, monkeypatch, tmp_path):
    from app.services import imports as imports_service
    from app.services.metadata_utils import ExtractedMetadata

    import_dir = tmp_path / "imports"
    import_dir.mkdir()
    image_path = import_dir / "prov-01.jpg"
    Image.new("RGB", (120, 80), color=(10, 120, 80)).save(image_path, format="JPEG")

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

    response = client.post("/api/v1/imports/photos", json={"source_path": str(import_dir)})
    assert response.status_code == 200
    import_run = response.json()["import_run"]
    assert import_run["files_imported"] == 1

    photos_response = client.get("/api/v1/photos", params={"date": "2025-07-19", "mode": "day"})
    assert photos_response.status_code == 200
    photos = photos_response.json()["photos"]
    assert len(photos) == 1
    assert photos[0]["ingest_run_id"] == import_run["id"]
    assert photos[0]["source_checksum"] is not None
    assert photos[0]["source_ref"] == "prov-01.jpg"

    asset_response = client.get(f"/api/v1/photos/{photos[0]['id']}/assets")
    assert asset_response.status_code == 200
    assets = asset_response.json()["assets"]
    assert len(assets) == 3
    assert assets[0]["kind"] == "original"
    assert assets[0]["ingest_run_id"] == import_run["id"]
    assert assets[0]["checksum"] == photos[0]["source_checksum"]
    assert assets[0]["source_ref"] == "prov-01.jpg"
    assert assets[0]["provenance"]["import_run_id"] == import_run["id"]


def test_photo_import_can_include_an_explicit_file_subset(client, monkeypatch, tmp_path):
    from app.services import imports as imports_service
    from app.services.metadata_utils import ExtractedMetadata

    import_dir = tmp_path / "imports"
    import_dir.mkdir()
    selected_dir = import_dir / "oblique"
    selected_dir.mkdir()
    selected_path = selected_dir / "DJI_20260802170900_0185_D.JPG"
    ignored_path = import_dir / "DJI_20260802170903_0186_D.JPG"
    Image.new("RGB", (120, 80), color=(10, 120, 80)).save(selected_path, format="JPEG")
    Image.new("RGB", (120, 80), color=(20, 100, 70)).save(ignored_path, format="JPEG")

    def _fake_extract_metadata(path):
        return ExtractedMetadata(
            source_file=str(path),
            captured_at=datetime(2026, 8, 2, 17, 9, 0),
            gps_latitude=59.184,
            gps_longitude=9.659,
            altitude_m=40.0,
            gps_altitude_m=40.0,
            relative_altitude_m=40.0,
            absolute_altitude_m=140.0,
            heading_deg=180.0,
            flight_yaw_degree=180.0,
            flight_pitch_degree=0.0,
            gimbal_pitch_degree=-45.0,
            gimbal_yaw_degree=180.0,
            compass=180.0,
            camera_pitch_degree=-45.0,
            camera_yaw_degree=180.0,
            source="test",
            raw={},
            issues=[],
        )

    monkeypatch.setattr(imports_service, "_extract_metadata", _fake_extract_metadata)
    monkeypatch.chdir(tmp_path)

    response = client.post(
        "/api/v1/imports/photos",
        json={
            "source_path": import_dir.name,
            "include_files": [f"{selected_dir.name}/{selected_path.name}"],
        },
    )

    assert response.status_code == 200
    import_run = response.json()["import_run"]
    assert import_run["files_seen"] == 1
    assert import_run["files_imported"] == 1
    assert import_run["files_skipped"] == 0

    photos_response = client.get("/api/v1/photos", params={"date": "2026-08-02", "mode": "day"})
    assert photos_response.status_code == 200
    photos = photos_response.json()["photos"]
    assert [photo["source_ref"] for photo in photos] == [f"{selected_dir.name}/{selected_path.name}"]


def test_photo_import_rejects_include_file_outside_source(client, tmp_path):
    import_dir = tmp_path / "imports"
    import_dir.mkdir()

    response = client.post(
        "/api/v1/imports/photos",
        json={
            "source_path": str(import_dir),
            "include_files": ["../outside.jpg"],
        },
    )

    assert response.status_code == 422


def test_photo_import_rejects_include_file_symlink_outside_source(client, tmp_path):
    import_dir = tmp_path / "imports"
    import_dir.mkdir()
    outside_path = tmp_path / "outside.jpg"
    Image.new("RGB", (120, 80), color=(10, 120, 80)).save(outside_path, format="JPEG")
    (import_dir / "linked.jpg").symlink_to(outside_path)

    response = client.post(
        "/api/v1/imports/photos",
        json={
            "source_path": str(import_dir),
            "include_files": ["linked.jpg"],
        },
    )

    assert response.status_code == 422


def test_photo_import_rejects_include_file_with_surrounding_whitespace(client, tmp_path):
    import_dir = tmp_path / "imports"
    import_dir.mkdir()

    response = client.post(
        "/api/v1/imports/photos",
        json={
            "source_path": str(import_dir),
            "include_files": [" photo.jpg"],
        },
    )

    assert response.status_code == 422
    assert "mellomrom" in response.text


def test_full_directory_import_preserves_missing_source_error(client, tmp_path):
    missing_source = tmp_path / "missing"

    with pytest.raises(FileNotFoundError, match="Katalog finnes ikke"):
        client.post(
            "/api/v1/imports/photos",
            json={"source_path": str(missing_source)},
        )
