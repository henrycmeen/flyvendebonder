from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Farm, FarmMembership, Photo, PhotoAsset, Property, User
from .image_derivatives import write_derivatives
from .pilot_identity import resolve_pilot_owner

settings = get_settings()


def _normalize_legacy_skien_code(db: Session, user: User) -> None:
    # Skien switched from 3807 to 4003. Keep existing seeded data aligned.
    if settings.default_municipality_code != "4003":
        return

    changed = False

    if user.municipality_code == "3807":
        user.municipality_code = "4003"
        changed = True

    legacy_properties = db.execute(select(Property).where(Property.user_id == user.id, Property.komm == "3807")).scalars().all()
    for property_obj in legacy_properties:
        duplicate = db.execute(
            select(Property.id).where(
                Property.user_id == user.id,
                Property.komm == "4003",
                Property.gnr == property_obj.gnr,
                Property.bnr == property_obj.bnr,
                Property.fnr == property_obj.fnr,
                Property.id != property_obj.id,
            )
        ).scalar_one_or_none()
        if duplicate is None:
            property_obj.komm = "4003"
            changed = True

    if changed:
        db.commit()
        db.refresh(user)


def _ensure_owner_farm(
    db: Session,
    *,
    user: User,
    property_obj: Property | None,
) -> Farm:
    farm = db.get(Farm, property_obj.farm_id) if property_obj is not None else None
    if farm is None:
        membership = (
            db.execute(
                select(FarmMembership)
                .where(FarmMembership.user_id == user.id)
                .where(FarmMembership.role == "owner")
                .order_by(FarmMembership.id)
            )
            .scalars()
            .first()
        )
        farm = db.get(Farm, membership.farm_id) if membership is not None else None

    if farm is None:
        farm = Farm(name=f"{user.full_name.strip()} gård")
        db.add(farm)
        db.flush()

    membership = db.execute(
        select(FarmMembership).where(
            FarmMembership.farm_id == farm.id,
            FarmMembership.user_id == user.id,
        )
    ).scalar_one_or_none()
    if membership is None:
        db.add(
            FarmMembership(
                farm_id=farm.id,
                user_id=user.id,
                role="owner",
                status="active",
            )
        )
    db.flush()
    return farm


def seed_default_user_and_property(db: Session) -> tuple[User, Property]:
    user = resolve_pilot_owner(db)
    if user is None:
        user = User(
            full_name=settings.default_user_name,
            city=settings.default_municipality_name,
            municipality_code=settings.default_municipality_code,
            municipality_name=settings.default_municipality_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        _normalize_legacy_skien_code(db, user)

    property_obj = db.execute(
        select(Property).where(
            Property.user_id == user.id,
            Property.komm == settings.default_municipality_code,
            Property.gnr == settings.default_gnr,
            Property.bnr == settings.default_bnr,
            Property.fnr == settings.default_fnr,
        )
    ).scalar_one_or_none()

    farm = _ensure_owner_farm(db, user=user, property_obj=property_obj)

    if property_obj is None:
        property_obj = Property(
            user_id=user.id,
            farm_id=farm.id,
            komm=settings.default_municipality_code,
            gnr=settings.default_gnr,
            bnr=settings.default_bnr,
            fnr=settings.default_fnr,
            label="Meen gård",
            active_from=date(2024, 1, 1),
            active_to=None,
        )
        db.add(property_obj)
    db.commit()
    db.refresh(property_obj)

    return user, property_obj


def seed_demo_photos_if_needed(db: Session, user: User, property_obj: Property) -> None:
    has_photo = db.execute(select(Photo.id).limit(1)).first()
    if has_photo:
        return

    geojson_file = settings.demo_seed_geojson
    if not geojson_file.exists():
        return

    data = json.loads(geojson_file.read_text(encoding="utf-8"))
    features = data.get("features") or []

    for feature in features:
        props = feature.get("properties") or {}
        geometry = feature.get("geometry") or {}
        coords = geometry.get("coordinates") or []
        if len(coords) < 2:
            continue

        photo_id = str(props.get("id") or "")
        image_rel = str(props.get("image") or "")
        if not photo_id or not image_rel:
            continue

        source_file = settings.demo_seed_assets_dir / Path(image_rel).name
        if not source_file.exists():
            continue

        source_hash = hashlib.sha256(source_file.read_bytes()).hexdigest()

        date_raw = str(props.get("date") or "")
        try:
            captured_date = date.fromisoformat(date_raw)
        except ValueError:
            captured_date = date.today()
        captured_at = datetime.combine(captured_date, datetime.min.time())

        photo = Photo(
            id=photo_id,
            user_id=user.id,
            property_id=property_obj.id,
            captured_at=captured_at,
            captured_date=captured_date,
            lat=float(coords[1]),
            lng=float(coords[0]),
            altitude_m=None,
            heading_deg=None,
            pitch_deg=None,
            source_filename=source_file.name,
            source_hash=source_hash,
            notes=str(props.get("caption") or ""),
            tags_json=json.dumps(props.get("tags") or [], ensure_ascii=False),
        )
        db.add(photo)
        db.flush()

        assets = write_derivatives(source_file, source_hash)
        for asset in assets:
            db.add(
                PhotoAsset(
                    photo_id=photo.id,
                    kind=asset["kind"],
                    path=asset["path"],
                    mime=asset["mime"],
                    bytes=asset["bytes"],
                    width=asset["width"],
                    height=asset["height"],
                )
            )

        db.commit()


def run_seeding(db: Session) -> None:
    user, property_obj = seed_default_user_and_property(db)
    seed_demo_photos_if_needed(db, user=user, property_obj=property_obj)
