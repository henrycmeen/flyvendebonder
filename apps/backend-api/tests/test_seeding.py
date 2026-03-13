from __future__ import annotations

import importlib
import json
import sys

from PIL import Image
from sqlalchemy import select


def _fresh_backend_modules() -> None:
    for module_name in (
        "app.config",
        "app.database",
        "app.logging_utils",
        "app.models",
        "app.services.image_derivatives",
        "app.services.seeding",
    ):
        sys.modules.pop(module_name, None)


def test_run_seeding_imports_demo_photo_assets(tmp_path, monkeypatch) -> None:
    db_file = tmp_path / "flyvendebonder-test.db"
    app_data_root = tmp_path / "storage"
    assets_dir = tmp_path / "demo-assets"
    assets_dir.mkdir()

    source_file = assets_dir / "jordet-01.jpg"
    Image.new("RGB", (640, 360), color=(80, 140, 90)).save(source_file, format="JPEG")

    geojson_file = tmp_path / "seed.geojson"
    geojson_file.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {"type": "Point", "coordinates": [10.1234, 59.1234]},
                        "properties": {
                            "id": "seed-photo-01",
                            "image": "nested/jordet-01.jpg",
                            "date": "2025-07-18",
                            "caption": "Seedet testfoto",
                            "tags": ["seed", "smoke"],
                        },
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("APP_DATA_ROOT", app_data_root.as_posix())
    monkeypatch.setenv("DEMO_SEED_GEOJSON", geojson_file.as_posix())
    monkeypatch.setenv("DEMO_SEED_ASSETS_DIR", assets_dir.as_posix())

    _fresh_backend_modules()

    importlib.import_module("app.main")
    from app.database import SessionLocal, run_migrations
    from app.models import Photo, PhotoAsset
    from app.services.seeding import run_seeding

    run_migrations()
    with SessionLocal() as db:
        run_seeding(db)

        photo = db.execute(select(Photo).where(Photo.id == "seed-photo-01")).scalar_one()
        assets = db.execute(select(PhotoAsset).where(PhotoAsset.photo_id == photo.id)).scalars().all()

    assert photo.source_filename == "jordet-01.jpg"
    assert {asset.kind for asset in assets} == {"original", "web", "thumb"}
