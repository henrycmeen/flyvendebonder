from __future__ import annotations

from datetime import datetime

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
