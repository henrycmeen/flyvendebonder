from __future__ import annotations

import json
import logging
import math
import os
import time
from datetime import date as date_type, datetime
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..logging_utils import read_recent_logs, request_id_ctx
from ..models import IngestRun, Photo, PhotoAnalysis, Property, User
from ..schemas import (
    BackendLogLine,
    BackendLogsResponse,
    GardskartJobResponse,
    PhotoAnalysisActionResponse,
    PhotoMetadataActionResponse,
    PhotoMetadataPatchRequest,
    PhotoAnalysisRefreshResponse,
    ImportRequest,
    ImportRunOut,
    PhotoPageResponse,
    PhotoResponse,
    ProfileOut,
    ProfilePatchRequest,
    PropertyOut,
    TimelineDateEntry,
    TimelineResponse,
    UserOut,
)
from ..services.gardskart import get_job_id
from ..services.imports import run_photo_ingest
from ..services.analysis_enrich import enrich_photo, rebuild_photo_analysis_for_user
from ..services.photos import load_photos_for_date, load_photos_page, timeline_dates

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()


def _current_user(db: Session) -> User:
    user = db.execute(select(User).order_by(User.id)).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="Ingen bruker registrert")
    return user


def _current_property(db: Session, user_id: int) -> Property | None:
    today = date_type.today()
    return (
        db.execute(
            select(Property)
            .where(Property.user_id == user_id)
            .where((Property.active_from.is_(None)) | (Property.active_from <= today))
            .where((Property.active_to.is_(None)) | (Property.active_to >= today))
            .order_by(Property.id)
        )
        .scalars()
        .first()
    )


def _normalize_tags(photo: Photo) -> list[str]:
    try:
        parsed = json.loads(photo.tags_json or "[]")
    except json.JSONDecodeError:
        return []
    return [str(tag) for tag in parsed if str(tag).strip()]


def _set_quality_flag(tags: list[str], needs_manual_qc: bool | None) -> list[str]:
    normalized = [tag for tag in tags if tag.strip()]
    normalized_set = set(normalized)

    if needs_manual_qc is None:
        return sorted(normalized_set)

    if needs_manual_qc:
        normalized_set.add("qc:needs_manual_qc")
    else:
        normalized_set.discard("qc:needs_manual_qc")

    return sorted(normalized_set)


def _extract_meta_value(tags: list[str], key: str) -> str | None:
    prefix = key.rstrip("=") + "="
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix) :].strip()
    return None


def _set_meta_value(tags: list[str], key: str, value: str | None) -> list[str]:
    prefix = key.rstrip("=") + "="
    filtered = [tag for tag in tags if not tag.startswith(prefix)]
    if value is not None:
        filtered.append(f"{prefix}{value}")
    return filtered


def _extract_manual_view_override(tags: list[str]) -> tuple[float | None, float | None]:
    raw_lat = _extract_meta_value(tags, "meta:manual_view_lat")
    raw_lng = _extract_meta_value(tags, "meta:manual_view_lng")
    if raw_lat is None or raw_lng is None:
        return None, None

    try:
        lat = float(raw_lat)
        lng = float(raw_lng)
    except (TypeError, ValueError):
        return None, None

    if not math.isfinite(lat) or not math.isfinite(lng):
        return None, None

    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        return None, None

    return lat, lng


def _set_manual_view_override(tags: list[str], lat: float | None, lng: float | None) -> list[str]:
    if lat is None and lng is None:
        cleared = _set_meta_value(tags, "meta:manual_view_lat", None)
        return _set_meta_value(cleared, "meta:manual_view_lng", None)

    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="Både manual_view_lat og manual_view_lng må settes sammen")

    if not math.isfinite(lat) or not math.isfinite(lng):
        raise HTTPException(status_code=400, detail="Manuelt målpunkt må være gyldige tall")

    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        raise HTTPException(status_code=400, detail="Manuelt målpunkt er utenfor gyldig koordinatområde")

    with_lat = _set_meta_value(tags, "meta:manual_view_lat", f"{lat:.6f}")
    return _set_meta_value(with_lat, "meta:manual_view_lng", f"{lng:.6f}")


def _serialize_tag_list(photo: Photo) -> list[str]:
    return _normalize_tags(photo)


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


@router.get("/logs", response_model=BackendLogsResponse)
def get_logs(limit: int = Query(default=200, ge=1, le=1000), level: str | None = Query(default=None)) -> BackendLogsResponse:
    if level and level.upper() not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise HTTPException(status_code=400, detail="Nyttig nivå: DEBUG, INFO, WARNING, ERROR, CRITICAL")

    lines = read_recent_logs(limit=limit, level=level)
    normalized = [
        BackendLogLine(
            timestamp=line.get("timestamp") or "",
            level=line.get("level") or "",
            logger=line.get("logger") or "",
            request_id=line.get("request_id"),
            message=line.get("message") or "",
            raw=line.get("raw") or "",
        )
        for line in lines
    ]

    return BackendLogsResponse(
        source=str(get_settings().log_file_path),
        count=len(normalized),
        generated_at=datetime.utcnow(),
        lines=normalized,
    )


@router.get("/profile/current", response_model=ProfileOut)
def get_profile_current(db: Session = Depends(get_db)) -> ProfileOut:
    user = _current_user(db)
    property_obj = _current_property(db, user.id)
    return ProfileOut(user=UserOut.model_validate(user), property=PropertyOut.model_validate(property_obj) if property_obj else None)


@router.patch("/profile/current", response_model=ProfileOut)
def patch_profile_current(
    payload: ProfilePatchRequest = Body(default_factory=ProfilePatchRequest),
    db: Session = Depends(get_db),
) -> ProfileOut:
    user = _current_user(db)
    property_obj = _current_property(db, user.id)

    user_data = payload.user.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    if property_obj is not None:
        property_data = payload.property.model_dump(exclude_unset=True)
        for key, value in property_data.items():
            setattr(property_obj, key, value)

    db.commit()
    db.refresh(user)
    if property_obj is not None:
        db.refresh(property_obj)

    return ProfileOut(user=UserOut.model_validate(user), property=PropertyOut.model_validate(property_obj) if property_obj else None)


@router.get("/timeline/dates", response_model=TimelineResponse)
def get_timeline_dates(
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> TimelineResponse:
    if user_id is None:
        user_id = _current_user(db).id

    dates = timeline_dates(db, user_id=user_id)
    return TimelineResponse(user_id=user_id, dates=[TimelineDateEntry(**item) for item in dates])


@router.get("/photos", response_model=PhotoResponse)
def get_photos(
    user_id: int | None = Query(default=None),
    date: date_type | None = Query(default=None),
    mode: str = Query(default="day", pattern="^(day|cumulative)$"),
    include_analysis: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> PhotoResponse:
    if user_id is None:
        user_id = _current_user(db).id

    timeline = timeline_dates(db, user_id=user_id)
    if not timeline:
        selected_date = date or date_type.today()
        return PhotoResponse(user_id=user_id, date=selected_date, mode=mode, count=0, photos=[])

    selected_date = date or timeline[-1]["date"]
    photos = load_photos_for_date(
        db,
        user_id=user_id,
        selected_date=selected_date,
        mode=mode,
        include_analysis=include_analysis,
    )

    return PhotoResponse(user_id=user_id, date=selected_date, mode=mode, count=len(photos), photos=photos)


@router.get("/photos/page", response_model=PhotoPageResponse)
def get_photos_page(
    user_id: int | None = Query(default=None),
    date: date_type = Query(...),
    mode: str = Query(default="cumulative", pattern="^(day|cumulative)$"),
    include_analysis: bool = Query(default=False),
    limit: int = Query(default=120, ge=1, le=300),
    cursor: str | None = Query(default=None),
    sort: str = Query(default="asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
) -> PhotoPageResponse:
    if user_id is None:
        user_id = _current_user(db).id

    try:
        photos, next_cursor = load_photos_page(
            db,
            user_id=user_id,
            selected_date=date,
            mode=mode,
            limit=limit,
            cursor=cursor,
            sort=sort,
            include_analysis=include_analysis,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PhotoPageResponse(
        user_id=user_id,
        date=date,
        mode=mode,
        count=len(photos),
        next_cursor=next_cursor,
        photos=photos,
    )


@router.post("/photos/{photo_id}/approve-analysis", response_model=PhotoAnalysisActionResponse)
def approve_photo_analysis(photo_id: str, db: Session = Depends(get_db)) -> PhotoAnalysisActionResponse:
    photo = db.execute(select(Photo).where(Photo.id == photo_id)).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke bilde")

    analysis = db.execute(select(PhotoAnalysis).where(PhotoAnalysis.photo_id == photo_id)).scalar_one_or_none()

    if analysis is None:
        try:
            analysis = enrich_photo(db, photo, force=True)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Kunne ikke bygge analyse for godkjenning", extra={"photo_id": photo_id, "error": str(exc)})
            raise HTTPException(status_code=502, detail=f"Kunne ikke bygge analyse for {photo_id}: {exc}") from exc

    analysis.approved = True
    analysis.geometry_method = analysis.geometry_method or "manual"
    analysis.confidence = 1.0
    db.commit()
    db.refresh(analysis)

    return PhotoAnalysisActionResponse(
        status="ok",
        photo_id=photo_id,
        analysis=analysis,
    )


@router.post("/photos/{photo_id}/recompute-analysis", response_model=PhotoAnalysisActionResponse)
def recompute_photo_analysis(photo_id: str, db: Session = Depends(get_db)) -> PhotoAnalysisActionResponse:
    photo = db.execute(select(Photo).where(Photo.id == photo_id)).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke bilde")

    try:
        analysis = enrich_photo(db, photo, force=True)
    except Exception as exc:  # noqa: BLE001
        logger.exception("Klarte ikke recompute analyse", extra={"photo_id": photo_id, "error": str(exc)})
        raise HTTPException(status_code=502, detail=f"Kunne ikke oppdatere analyse: {exc}") from exc

    return PhotoAnalysisActionResponse(
        status="ok",
        photo_id=photo_id,
        analysis=analysis,
    )


@router.patch("/photos/{photo_id}/metadata", response_model=PhotoMetadataActionResponse)
def patch_photo_metadata(
    photo_id: str,
    payload: PhotoMetadataPatchRequest = Body(default_factory=PhotoMetadataPatchRequest),
    db: Session = Depends(get_db),
) -> PhotoMetadataActionResponse:
    photo = db.execute(select(Photo).where(Photo.id == photo_id)).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke bilde")

    tags: list[str]
    try:
        tags = _serialize_tag_list(photo)
    except Exception:  # noqa: BLE001
        tags = []

    if payload.tags is not None:
        normalized_tags: list[str] = []
        seen: set[str] = set()
        for item in payload.tags:
            tag = str(item).strip()
            if not tag:
                continue
            key = tag.casefold()
            if key in seen:
                continue
            seen.add(key)
            normalized_tags.append(tag[:72])
        tags = normalized_tags
        photo.tags_json = json.dumps(tags, ensure_ascii=False)

    if payload.caption is not None:
        cleaned_caption = payload.caption.strip()
        photo.notes = cleaned_caption if cleaned_caption else None

    if payload.needs_manual_qc is not None:
        tags = _set_quality_flag(tags, payload.needs_manual_qc)
        photo.tags_json = json.dumps(tags, ensure_ascii=False)

    if "manual_view_lat" in payload.model_fields_set or "manual_view_lng" in payload.model_fields_set:
        if "manual_view_lat" not in payload.model_fields_set or "manual_view_lng" not in payload.model_fields_set:
            raise HTTPException(status_code=400, detail="Både manual_view_lat og manual_view_lng må sendes sammen")
        tags = _set_manual_view_override(tags, payload.manual_view_lat, payload.manual_view_lng)
        photo.tags_json = json.dumps(tags, ensure_ascii=False)

    if "altitude_m" in payload.model_fields_set:
        photo.altitude_m = payload.altitude_m
    if "heading_deg" in payload.model_fields_set:
        photo.heading_deg = payload.heading_deg
    if "pitch_deg" in payload.model_fields_set:
        photo.pitch_deg = payload.pitch_deg

    needs_manual_qc = "qc:needs_manual_qc" in tags
    manual_view_lat, manual_view_lng = _extract_manual_view_override(tags)

    db.commit()
    db.refresh(photo)

    return PhotoMetadataActionResponse(
        status="ok",
        photo_id=photo.id,
        tags=tags,
        caption=photo.notes,
        needs_manual_qc=needs_manual_qc,
        altitude_m=photo.altitude_m,
        heading_deg=photo.heading_deg,
        pitch_deg=photo.pitch_deg,
        manual_view_lat=manual_view_lat,
        manual_view_lng=manual_view_lng,
    )


@router.post("/analysis/refresh", response_model=PhotoAnalysisRefreshResponse)
def refresh_analysis(
    user_id: int | None = Query(default=None),
    force: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> PhotoAnalysisRefreshResponse:
    if user_id is None:
        user_id = _current_user(db).id

    results = rebuild_photo_analysis_for_user(db, user_id=user_id, force=force)
    return PhotoAnalysisRefreshResponse(**results)


@router.get("/properties/current")
def get_current_property_endpoint(db: Session = Depends(get_db)) -> dict:
    user = _current_user(db)
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    return {"property": PropertyOut.model_validate(property_obj)}


@router.get("/properties/current/gardskart-job", response_model=GardskartJobResponse)
async def get_current_gardskart_job(
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> GardskartJobResponse:
    user = _current_user(db)
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    try:
        cache, source = await get_job_id(db, property_obj=property_obj, force_refresh=force_refresh)
        now = datetime.utcnow()
        return GardskartJobResponse(
            property_id=property_obj.id,
            job_id=cache.job_id,
            status_code=cache.status_code,
            status_desc=cache.status_desc,
            fetched_at=cache.fetched_at,
            expires_at=cache.expires_at,
            source=source,
            is_expired=cache.expires_at <= now,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Gardskart jobId henting feilet", extra={"error": str(exc)})
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente jobId: {exc}") from exc


@router.post("/imports/photos")
def post_import_photos(
    payload: ImportRequest = Body(default_factory=ImportRequest),
    db: Session = Depends(get_db),
) -> dict:
    source = Path(payload.source_path) if payload.source_path else settings.imports_default_source
    run = run_photo_ingest(db, source)
    return {"import_run": ImportRunOut.model_validate(run)}


@router.get("/imports/{run_id}")
def get_import_run(run_id: int, db: Session = Depends(get_db)) -> dict:
    run = db.execute(select(IngestRun).where(IngestRun.id == run_id)).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Fant ikke ingest-run")
    return {"import_run": ImportRunOut.model_validate(run)}


@router.get("/assets/{asset_path:path}")
def get_asset(asset_path: str, request: Request) -> Response:
    root = settings.app_data_root.resolve()
    target = (root / asset_path).resolve()

    if root != target and root not in target.parents:
        raise HTTPException(status_code=403, detail="Ugyldig filsti")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fant ikke fil")

    normalized = asset_path.strip("/")
    if normalized.startswith("photos/thumb/") or normalized.startswith("photos/web/"):
        cache_control = "public, max-age=31536000, immutable"
        asset_kind = "thumb" if normalized.startswith("photos/thumb/") else "web"
    elif normalized.startswith("photos/original/"):
        cache_control = "public, max-age=3600"
        asset_kind = "original"
    else:
        cache_control = "public, max-age=3600"
        asset_kind = "other"

    started = time.perf_counter()
    stat_result = os.stat(target)
    response = FileResponse(target, stat_result=stat_result)
    response.headers["Cache-Control"] = cache_control

    etag = response.headers.get("etag")
    if_none_match = request.headers.get("if-none-match")
    if etag and if_none_match:
        raw_tokens = [token.strip() for token in if_none_match.split(",")]
        tokens = [token[2:] if token.startswith("W/") else token for token in raw_tokens]
        if etag in tokens or "*" in tokens:
            not_modified = Response(status_code=304)
            not_modified.headers["ETag"] = etag
            if "last-modified" in response.headers:
                not_modified.headers["Last-Modified"] = response.headers["last-modified"]
            not_modified.headers["Cache-Control"] = cache_control
            logger.info(
                "Asset 304 req_id=%s kind=%s path=%s",
                request_id_ctx.get("-"),
                asset_kind,
                normalized,
            )
            return not_modified

    elapsed_ms = (time.perf_counter() - started) * 1000

    logger.info(
        "Asset levert req_id=%s kind=%s bytes=%s elapsed_ms=%.2f path=%s",
        request_id_ctx.get("-"),
        asset_kind,
        stat_result.st_size,
        elapsed_ms,
        normalized,
    )

    return response
