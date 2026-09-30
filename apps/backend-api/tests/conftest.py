from __future__ import annotations

import importlib
import json
from datetime import date, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from tests.backend_modules import fresh_backend_modules


@pytest.fixture
def client(tmp_path, monkeypatch):
    sample_date = date(2025, 7, 18)
    db_file = tmp_path / "flyvendebonder-test.db"
    app_data_root = tmp_path / "storage"
    empty_geojson = tmp_path / "seed.geojson"
    empty_assets = tmp_path / "demo-assets"
    empty_geojson.write_text(json.dumps({"type": "FeatureCollection", "features": []}, ensure_ascii=False), encoding="utf-8")

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_file.as_posix()}")
    monkeypatch.setenv("LOG_TO_FILE", "false")
    monkeypatch.setenv("LOG_FILE_PATH", (tmp_path / "backend.log").as_posix())
    monkeypatch.setenv("APP_DATA_ROOT", app_data_root.as_posix())
    monkeypatch.setenv("DEMO_SEED_GEOJSON", empty_geojson.as_posix())
    monkeypatch.setenv("DEMO_SEED_ASSETS_DIR", empty_assets.as_posix())
    monkeypatch.setenv("PHOTO_AR5_ENABLED", "false")
    monkeypatch.setenv("PHOTO_AR5_WMS_URL", "")
    monkeypatch.setenv("PHOTO_AR5_WMS_LAYERS", "")
    monkeypatch.setenv("PHOTO_SOIL_WMS_URL", "")
    monkeypatch.setenv("PHOTO_SOIL_WMS_LAYERS", "")
    monkeypatch.setenv("PHOTO_AR5_WFS_URL", "")
    monkeypatch.setenv("PHOTO_AR5_WFS_LAYERS", "")
    monkeypatch.setenv("PHOTO_SOIL_WFS_URL", "")
    monkeypatch.setenv("PHOTO_SOIL_WFS_LAYERS", "")
    monkeypatch.setenv("ADMIN_ACCESS_OPEN", "false")
    monkeypatch.setenv("ADMIN_ACCESS_CODE", "test-admin-code")
    monkeypatch.setenv("ADMIN_SESSION_SECRET", "test-admin-secret")

    fresh_backend_modules()

    main_module = importlib.import_module("app.main")
    # Ordinary API scenarios use deterministic offline terrain. DEM scenarios
    # explicitly override this sampler to cover varying heights and failures.
    monkeypatch.setattr(
        "app.services.flight_missions.sample_terrain_elevations",
        lambda points: [100.0] * len(points),
    )
    from app.config import get_settings
    from app.database import SessionLocal
    from app.models import Photo, PhotoAsset, Property, User
    from sqlalchemy import select

    client = TestClient(main_module.app)
    client.__enter__()

    try:
        settings = get_settings()
        with SessionLocal() as db:
            user = db.execute(select(User).where(User.full_name == "Roar Meen")).scalar_one()
            property_obj = db.execute(
                select(Property)
                .where(Property.user_id == user.id)
                .order_by(Property.id.asc())
            ).scalars().first()

            thumb_dir = settings.app_data_root / "photos" / "thumb"
            web_dir = settings.app_data_root / "photos" / "web"
            thumb_dir.mkdir(parents=True, exist_ok=True)
            web_dir.mkdir(parents=True, exist_ok=True)

            for index in range(3):
                photo_id = f"smoke-{sample_date.isoformat()}-{index:02d}"
                captured_at = datetime.combine(sample_date, datetime.min.time()) + timedelta(minutes=index)
                photo = Photo(
                    id=photo_id,
                    user_id=user.id,
                    property_id=property_obj.id if property_obj else None,
                    captured_at=captured_at,
                    captured_date=sample_date,
                    lat=59.0001 + (index * 0.0001),
                    lng=10.0002 + (index * 0.0001),
                    altitude_m=None,
                    heading_deg=None,
                    source_filename=f"{photo_id}.jpg",
                    source_hash=f"smoketesthash-{index:02d}".ljust(64, "0"),
                    notes="Testfoto fra smoke-test",
                    tags_json='["smoke", "api-test"]',
                )
                db.add(photo)
                db.flush()

                thumb_file = thumb_dir / f"{photo_id}.jpg"
                web_file = web_dir / f"{photo_id}.jpg"

                image = Image.new("RGB", (320, 180), color=(20 + index * 40, 80, 160))
                image.save(thumb_file, format="JPEG", quality=60)
                image.save(web_file, format="JPEG", quality=70)

                for asset_kind, asset_file in ("thumb", thumb_file), ("web", web_file):
                    db.add(
                        PhotoAsset(
                            photo_id=photo_id,
                            kind=asset_kind,
                            path=f"photos/{asset_kind}/{asset_file.name}",
                            mime="image/jpeg",
                            bytes=asset_file.stat().st_size,
                            width=320,
                            height=180,
                        )
                    )

            db.commit()

        login_response = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
        assert login_response.status_code == 200

        yield client
    finally:
        client.__exit__(None, None, None)
