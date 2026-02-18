from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import SessionLocal, run_migrations
from app.models import PhotoAsset
from app.services.image_derivatives import write_derivatives

settings = get_settings()


def _fetch_original_assets(db: Session, photo_id_prefix: str | None, limit: int | None) -> list[PhotoAsset]:
    query = select(PhotoAsset).where(PhotoAsset.kind == "original").order_by(PhotoAsset.photo_id)
    if photo_id_prefix:
        query = query.where(PhotoAsset.photo_id.like(f"{photo_id_prefix}%"))
    if limit is not None:
        query = query.limit(limit)

    return list(db.execute(query).scalars().all())


def _upsert_derivative_assets(db: Session, photo_id: str, payloads: list[dict]) -> None:
    existing_rows = db.execute(
        select(PhotoAsset).where(PhotoAsset.photo_id == photo_id, PhotoAsset.kind.in_(("web", "thumb")))
    ).scalars().all()
    existing = {row.kind: row for row in existing_rows}

    for payload in payloads:
        row = existing.get(payload["kind"])
        if row is None:
            db.add(
                PhotoAsset(
                    photo_id=photo_id,
                    kind=payload["kind"],
                    path=payload["path"],
                    mime=payload["mime"],
                    bytes=payload["bytes"],
                    width=payload["width"],
                    height=payload["height"],
                )
            )
            continue

        row.path = payload["path"]
        row.mime = payload["mime"]
        row.bytes = payload["bytes"]
        row.width = payload["width"]
        row.height = payload["height"]


def _rebuild_one(photo_id: str, original_asset_path: str) -> tuple[str, list[dict]]:
    source = settings.app_data_root / original_asset_path
    if not source.exists() or not source.is_file():
        raise FileNotFoundError(f"Mangler originalfil: {source}")

    source_hash = Path(original_asset_path).stem
    assets = write_derivatives(source=source, source_hash=source_hash)
    derivatives = [asset for asset in assets if asset["kind"] in {"web", "thumb"}]
    return photo_id, derivatives


def main() -> int:
    parser = argparse.ArgumentParser(description="Regenerer web/thumb-derivater for alle importerte bilder")
    parser.add_argument("--dry-run", action="store_true", help="Vis hva som ville blitt regenerert uten å skrive filer/DB")
    parser.add_argument("--photo-id-prefix", type=str, default=None, help="Begrens til photo_id som starter med prefix")
    parser.add_argument("--limit", type=int, default=None, help="Maks antall foto å prosessere")
    parser.add_argument("--workers", type=int, default=1, help="Antall parallelle workers (default: 1)")
    args = parser.parse_args()

    if args.workers < 1:
        raise SystemExit("--workers må være >= 1")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit må være >= 1")

    run_migrations()

    with SessionLocal() as db:
        originals = _fetch_original_assets(db, args.photo_id_prefix, args.limit)

        print(f"Fant {len(originals)} originalbilder")
        if not originals:
            return 0

        if args.dry_run:
            for asset in originals:
                print(f"[dry-run] {asset.photo_id} -> regenerer web/thumb fra {asset.path}")
            return 0

        processed = 0
        errors = 0

        if args.workers == 1:
            for asset in originals:
                try:
                    photo_id, payloads = _rebuild_one(photo_id=asset.photo_id, original_asset_path=asset.path)
                    _upsert_derivative_assets(db, photo_id=photo_id, payloads=payloads)
                    db.commit()
                    processed += 1
                    print(f"[ok] {photo_id}")
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    errors += 1
                    print(f"[fail] {asset.photo_id}: {exc}")
        else:
            with ThreadPoolExecutor(max_workers=args.workers) as pool:
                futures = [
                    pool.submit(_rebuild_one, asset.photo_id, asset.path)
                    for asset in originals
                ]
                for future in as_completed(futures):
                    try:
                        photo_id, payloads = future.result()
                        _upsert_derivative_assets(db, photo_id=photo_id, payloads=payloads)
                        db.commit()
                        processed += 1
                        print(f"[ok] {photo_id}")
                    except Exception as exc:  # noqa: BLE001
                        db.rollback()
                        errors += 1
                        print(f"[fail] {exc}")

        print(f"Ferdig. Prosessert={processed} feil={errors}")
        return 0 if errors == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
