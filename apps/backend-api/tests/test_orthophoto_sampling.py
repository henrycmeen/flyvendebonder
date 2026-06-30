from __future__ import annotations

import importlib
import json
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from tests.backend_modules import fresh_backend_modules


def _write_overlay_fixture(root: Path, *, transparent: bool = False) -> dict:
    root.mkdir(parents=True, exist_ok=True)
    source_file = root / "canonical.tif"
    preview_file = root / "preview.webp"

    image = Image.new("RGBA", (5, 5), color=(20, 80, 30, 255))
    for x in range(1, 4):
        for y in range(1, 4):
            image.putpixel((x, y), (40, 120, 50, 0 if transparent else 255))
    image.save(source_file, format="TIFF")
    image.save(preview_file, format="WEBP")

    metadata = {
        "width_px": 5,
        "height_px": 5,
        "preview_width_px": 5,
        "preview_height_px": 5,
        "utm_bounds": {
            "westing": 500_000,
            "southing": 6_550_000,
            "easting": 500_050,
            "northing": 6_550_050,
        },
        "source_file": str(source_file),
        "preview_file": str(preview_file),
        "overlay": {
            "id": "test-orthophoto",
            "label": "Test ortofoto",
            "propertyReference": "4003-70/17/0",
            "assetFile": preview_file.name,
            "capturedDate": "2026-04-01",
            "bounds": {
                "south": 59.0,
                "west": 9.0,
                "north": 60.0,
                "east": 10.0,
            },
        },
    }
    (root / "test-orthophoto.json").write_text(json.dumps(metadata), encoding="utf-8")
    return metadata


def test_sample_orthophoto_color_prefers_available_canonical_source(tmp_path):
    overlay_root = tmp_path / "overlays"
    _write_overlay_fixture(overlay_root)

    from app.services.orthophoto_sampling import sample_orthophoto_color

    sample = sample_orthophoto_color(
        "test-orthophoto",
        lat=59.5,
        lng=9.5,
        sample_size_px=3,
        overlay_root=overlay_root,
    )

    assert sample["source"]["kind"] == "canonical"
    assert sample["source"]["path_basename"] == "canonical.tif"
    assert sample["source"]["gsd_m_per_px"] == {"x": 10.0, "y": 10.0}
    assert sample["image_pixel"] == {"x": 2.5, "y": 2.5, "ratio_x": 0.5, "ratio_y": 0.5}
    assert sample["analysis"]["requested_size_px"] == 3
    assert sample["analysis"]["valid_pixels"] == 9
    assert sample["analysis"]["mean_rgb"] == {"r": 40.0, "g": 120.0, "b": 50.0}
    assert sample["analysis"]["median_rgb"] == {"r": 40.0, "g": 120.0, "b": 50.0}
    assert sample["analysis"]["indices"]["exg"] > 0


def test_sample_orthophoto_color_reports_no_data(tmp_path):
    overlay_root = tmp_path / "overlays"
    _write_overlay_fixture(overlay_root, transparent=True)

    from app.services.orthophoto_sampling import OrthophotoNoData, sample_orthophoto_color

    try:
        sample_orthophoto_color(
            "test-orthophoto",
            lat=59.5,
            lng=9.5,
            sample_size_px=3,
            overlay_root=overlay_root,
        )
    except OrthophotoNoData as exc:
        assert "no-data" in str(exc)
    else:
        raise AssertionError("Expected transparent crop to raise OrthophotoNoData")


def test_sample_orthophoto_color_falls_back_to_local_default_root(tmp_path, monkeypatch):
    overlay_root = tmp_path / "local-dev-overlays"
    _write_overlay_fixture(overlay_root)
    missing_root = tmp_path / "missing-deployed-root"

    monkeypatch.setenv("ORTHOPHOTO_OVERLAY_ROOT", missing_root.as_posix())
    fresh_backend_modules()
    sampling_module = importlib.import_module("app.services.orthophoto_sampling")
    monkeypatch.setattr(sampling_module, "LOCAL_ORTHOPHOTO_OVERLAY_ROOT", overlay_root)

    sample = sampling_module.sample_orthophoto_color(
        "test-orthophoto",
        lat=59.5,
        lng=9.5,
        sample_size_px=3,
    )

    assert sample["overlay"]["id"] == "test-orthophoto"
    assert sample["source"]["kind"] == "canonical"


def test_orthophoto_color_sample_api_maps_bounds_error(tmp_path, monkeypatch):
    overlay_root = tmp_path / "overlays"
    db_file = tmp_path / "flyvendebonder-test.db"
    app_data_root = tmp_path / "storage"
    empty_geojson = tmp_path / "seed.geojson"
    empty_assets = tmp_path / "demo-assets"
    empty_geojson.write_text(json.dumps({"type": "FeatureCollection", "features": []}), encoding="utf-8")
    _write_overlay_fixture(overlay_root)

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("LOG_TO_FILE", "false")
    monkeypatch.setenv("LOG_FILE_PATH", (tmp_path / "backend.log").as_posix())
    monkeypatch.setenv("APP_DATA_ROOT", app_data_root.as_posix())
    monkeypatch.setenv("DEMO_SEED_GEOJSON", empty_geojson.as_posix())
    monkeypatch.setenv("DEMO_SEED_ASSETS_DIR", empty_assets.as_posix())
    monkeypatch.setenv("ORTHOPHOTO_OVERLAY_ROOT", overlay_root.as_posix())

    fresh_backend_modules()
    main_module = importlib.import_module("app.main")

    with TestClient(main_module.app) as client:
        response = client.get(
            "/api/v1/orthophotos/test-orthophoto/color-sample",
            params={"lat": 61.0, "lng": 9.5, "sample_size_px": 3},
        )

    assert response.status_code == 422
    assert response.json()["detail"] == "Punktet ligger utenfor ortofotoets bounds."
