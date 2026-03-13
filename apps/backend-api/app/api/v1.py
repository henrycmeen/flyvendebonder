from __future__ import annotations

import json
import logging
import math
import os
import time
from datetime import date as date_type, datetime
from pathlib import Path

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..database import get_db
from ..logging_utils import read_recent_logs, request_id_ctx
from ..models import FieldPlot, IngestRun, Photo, PhotoAnalysis, Property, User
from ..schemas import (
    AdminLoginRequest,
    AdminSessionStatusResponse,
    BackendLogLine,
    BackendLogsResponse,
    FieldPlotCreate,
    FieldPlotDeleteResponse,
    FieldPlotListResponse,
    FieldPlotOut,
    FieldPlotPatch,
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
from ..services.admin_access import (
    admin_access_is_configured,
    clear_admin_session,
    get_admin_session,
    issue_admin_session,
    require_admin_session,
    verify_admin_access_code,
)
from ..services.gardskart import get_job_id
from ..services.imports import run_photo_ingest
from ..services.analysis_enrich import enrich_photo, rebuild_photo_analysis_for_user
from ..services.field_plots import normalize_polygon_coordinates, polygon_area_m2
from ..services.photos import load_photos_for_date, load_photos_page, timeline_dates
from ..services.tag_utils import (
    extract_meta_float,
    normalize_user_tags,
    parse_tag_groups,
    set_quality_flag,
    serialize_tag_groups,
    merge_tag_groups,
)
from ..services.view_overrides import set_manual_view_override

router = APIRouter()
logger = logging.getLogger(__name__)
settings = get_settings()

_METADATA_ALTITUDE_MIN_M = -500.0
_METADATA_ALTITUDE_MAX_M = 12_000.0
_METADATA_HEADING_MIN_DEG = -360.0
_METADATA_HEADING_MAX_DEG = 360.0
_METADATA_PITCH_MIN_DEG = -90.0
_METADATA_PITCH_MAX_DEG = 90.0


def _current_user(db: Session) -> User:
    user = db.execute(select(User).order_by(User.id)).scalars().first()
    if user is None:
        raise HTTPException(status_code=404, detail="Ingen bruker registrert")
    return user


def _current_property(db: Session, user_id: int) -> Property | None:
    properties = _active_properties(db, user_id)
    return properties[0] if properties else None


def _active_properties(db: Session, user_id: int) -> list[Property]:
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
        .all()
    )


def _active_property_by_id(db: Session, user_id: int, property_id: int) -> Property | None:
    properties = _active_properties(db, user_id)
    return next((item for item in properties if item.id == property_id), None)


def _profile_out(db: Session, user: User) -> ProfileOut:
    properties = _active_properties(db, user.id)
    current = properties[0] if properties else None
    additional = properties[1:] if len(properties) > 1 else []
    return ProfileOut(
        user=UserOut.model_validate(user),
        property=PropertyOut.model_validate(current) if current else None,
        additional_properties=[PropertyOut.model_validate(item) for item in additional],
    )


def _normalize_additional_property_payload(raw_item, *, index: int) -> dict[str, object] | None:
    komm = (raw_item.komm or "").strip()
    label = (raw_item.label or "").strip() or None
    gnr = raw_item.gnr
    bnr = raw_item.bnr
    fnr = raw_item.fnr

    has_any_value = any(
        (
            komm,
            label,
            gnr is not None,
            bnr is not None,
            fnr is not None,
        )
    )
    if not has_any_value:
        return None

    missing_fields: list[str] = []
    if not komm:
        missing_fields.append("kommunekode")
    if gnr is None:
        missing_fields.append("gnr")
    if bnr is None:
        missing_fields.append("bnr")
    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail=f"Ekstra eiendom #{index + 1} mangler {', '.join(missing_fields)}",
        )

    return {
        "komm": komm,
        "gnr": int(gnr),
        "bnr": int(bnr),
        "fnr": int(fnr) if fnr is not None else 0,
        "label": label,
    }


async def _build_gardskart_job_response(
    db: Session,
    property_obj: Property,
    *,
    force_refresh: bool,
) -> GardskartJobResponse:
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
        logger.exception("Gardskart jobId henting feilet", extra={"error": str(exc), "property_id": property_obj.id})
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente jobId: {exc}") from exc


def _parse_stored_tags(photo: Photo) -> tuple[list[str], list[str]]:
    return parse_tag_groups(photo.tags_json)


def _validate_user_tags_payload(payload_tags: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for item in payload_tags:
        tag = str(item).strip()
        if not tag:
            continue
        key = tag.casefold()
        if key.startswith("meta:") or key.startswith("qc:"):
            raise HTTPException(
                status_code=400,
                detail="Bruker-tags kan ikke inneholde meta:- eller qc:-prefikser",
            )
        if key in seen:
            continue
        seen.add(key)
        normalized.append(tag[:72])
    return normalize_user_tags(normalized)


def _validate_numeric_override(
    field_name: str,
    value: float | None,
    *,
    min_value: float,
    max_value: float,
) -> float | None:
    if value is None:
        return None

    if not math.isfinite(value):
        raise HTTPException(status_code=400, detail=f"{field_name} må være et gyldig tall")

    if value < min_value or value > max_value:
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} må være mellom {min_value:g} og {max_value:g}",
        )

    return float(value)


def _require_current_property(db: Session, user_id: int) -> Property:
    property_obj = _current_property(db, user_id)
    if property_obj is None:
        raise HTTPException(status_code=400, detail="Ingen aktiv eiendom er valgt")
    return property_obj


def _normalize_field_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _field_plot_out(item: FieldPlot) -> FieldPlotOut:
    area_m2 = round(item.area_m2, 2) if item.area_m2 is not None else None
    return FieldPlotOut(
        id=item.id,
        property_id=item.property_id,
        name=item.name,
        source=item.source,
        status=item.status,
        geometry=json.loads(item.geometry_json),
        area_m2=area_m2,
        area_ha=round(area_m2 / 10_000, 4) if area_m2 is not None else None,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _field_geometry_payload(geometry) -> tuple[str, float]:
    try:
        normalized_coordinates = normalize_polygon_coordinates(geometry.coordinates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    area_m2 = polygon_area_m2(normalized_coordinates)
    if area_m2 <= 1.0:
        raise HTTPException(status_code=400, detail="Polygonet er for lite til å lagres som jordutkast")
    return (
        json.dumps({"type": "Polygon", "coordinates": normalized_coordinates}, ensure_ascii=False),
        area_m2,
    )


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


@router.get("/logs", response_model=BackendLogsResponse)
def get_logs(
    limit: int = Query(default=200, ge=1, le=1000),
    level: str | None = Query(default=None),
    _admin_session=Depends(require_admin_session),
) -> BackendLogsResponse:
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


@router.get("/admin/session", response_model=AdminSessionStatusResponse)
def get_admin_session_status(request: Request, response: Response) -> AdminSessionStatusResponse:
    session = get_admin_session(request)
    if request.cookies.get(settings.admin_session_cookie_name) and session is None:
        clear_admin_session(response)

    return AdminSessionStatusResponse(
        configured=admin_access_is_configured(),
        authenticated=session is not None,
        expires_at=session.expires_at if session else None,
    )


@router.post("/admin/login", response_model=AdminSessionStatusResponse)
def login_admin(
    payload: AdminLoginRequest,
    request: Request,
    response: Response,
) -> AdminSessionStatusResponse:
    if not admin_access_is_configured():
        raise HTTPException(status_code=503, detail="Admin-innlogging er ikke konfigurert i backend")
    if not verify_admin_access_code(payload.code):
        raise HTTPException(status_code=401, detail="Ugyldig admin-kode")

    session = issue_admin_session(response, request)
    return AdminSessionStatusResponse(configured=True, authenticated=True, expires_at=session.expires_at)


@router.post("/admin/logout", response_model=AdminSessionStatusResponse)
def logout_admin(response: Response) -> AdminSessionStatusResponse:
    clear_admin_session(response)
    return AdminSessionStatusResponse(configured=admin_access_is_configured(), authenticated=False, expires_at=None)


@router.get("/profile/current", response_model=ProfileOut)
def get_profile_current(db: Session = Depends(get_db)) -> ProfileOut:
    user = _current_user(db)
    return _profile_out(db, user)


@router.patch("/profile/current", response_model=ProfileOut)
def patch_profile_current(
    payload: ProfilePatchRequest = Body(default_factory=ProfilePatchRequest),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> ProfileOut:
    user = _current_user(db)
    active_properties = _active_properties(db, user.id)
    property_obj = active_properties[0] if active_properties else None

    user_data = payload.user.model_dump(exclude_unset=True)
    for key, value in user_data.items():
        setattr(user, key, value)

    property_data = payload.property.model_dump(exclude_unset=True)
    if property_obj is not None:
        for key, value in property_data.items():
            setattr(property_obj, key, value)

    try:
        if payload.additional_properties is not None:
            additional_existing = {item.id: item for item in active_properties[1:]}
            kept_ids: set[int] = set()

            for index, additional_payload in enumerate(payload.additional_properties):
                normalized = _normalize_additional_property_payload(additional_payload, index=index)
                if normalized is None:
                    continue

                if additional_payload.id is not None:
                    property_item = additional_existing.get(additional_payload.id)
                    if property_item is None:
                        raise HTTPException(status_code=404, detail=f"Fant ikke ekstra eiendom {additional_payload.id}")
                    for key, value in normalized.items():
                        setattr(property_item, key, value)
                    kept_ids.add(property_item.id)
                    continue

                property_item = Property(
                    user_id=user.id,
                    komm=str(normalized["komm"]),
                    gnr=int(normalized["gnr"]),
                    bnr=int(normalized["bnr"]),
                    fnr=int(normalized["fnr"]),
                    label=normalized["label"],
                )
                db.add(property_item)
                db.flush()
                kept_ids.add(property_item.id)

            for property_id, property_item in additional_existing.items():
                if property_id not in kept_ids:
                    db.delete(property_item)

        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Eiendomslisten inneholder duplikater eller ugyldig kombinasjon") from exc

    db.refresh(user)
    return _profile_out(db, user)


@router.get("/timeline/dates", response_model=TimelineResponse)
def get_timeline_dates(
    user_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
) -> TimelineResponse:
    if user_id is None:
        user_id = _current_user(db).id

    dates = timeline_dates(db, user_id=user_id)
    return TimelineResponse(user_id=user_id, dates=[TimelineDateEntry(**item) for item in dates])


@router.get("/fields", response_model=FieldPlotListResponse)
def list_field_plots(db: Session = Depends(get_db)) -> FieldPlotListResponse:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    field_plots = (
        db.execute(
            select(FieldPlot)
            .where(FieldPlot.property_id == property_obj.id)
            .order_by(FieldPlot.updated_at.desc(), FieldPlot.id.desc())
        )
        .scalars()
        .all()
    )
    return FieldPlotListResponse(
        property_id=property_obj.id,
        count=len(field_plots),
        fields=[_field_plot_out(item) for item in field_plots],
    )


@router.post("/fields", response_model=FieldPlotOut, status_code=status.HTTP_201_CREATED)
def create_field_plot(
    payload: FieldPlotCreate = Body(...),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FieldPlotOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    geometry_json, area_m2 = _field_geometry_payload(payload.geometry)

    item = FieldPlot(
        property_id=property_obj.id,
        name=_normalize_field_name(payload.name),
        source=payload.source,
        status=payload.status,
        geometry_json=geometry_json,
        area_m2=area_m2,
    )
    db.add(item)
    db.flush()

    if item.name is None:
        item.name = f"Jordutkast {item.id}"

    db.commit()
    db.refresh(item)
    return _field_plot_out(item)


@router.patch("/fields/{field_id}", response_model=FieldPlotOut)
def patch_field_plot(
    field_id: int,
    payload: FieldPlotPatch = Body(default_factory=FieldPlotPatch),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FieldPlotOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(select(FieldPlot).where(FieldPlot.id == field_id, FieldPlot.property_id == property_obj.id))
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke jordutkast")

    if "name" in payload.model_fields_set:
        item.name = _normalize_field_name(payload.name)
    if payload.source is not None:
        item.source = payload.source
    if payload.status is not None:
        item.status = payload.status
    if payload.geometry is not None:
        item.geometry_json, item.area_m2 = _field_geometry_payload(payload.geometry)

    db.commit()
    db.refresh(item)
    return _field_plot_out(item)


@router.delete("/fields/{field_id}", response_model=FieldPlotDeleteResponse)
def delete_field_plot(
    field_id: int,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FieldPlotDeleteResponse:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(select(FieldPlot).where(FieldPlot.id == field_id, FieldPlot.property_id == property_obj.id))
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke jordutkast")

    db.delete(item)
    db.commit()
    return FieldPlotDeleteResponse(status="deleted", field_id=field_id)


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
def approve_photo_analysis(
    photo_id: str,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> PhotoAnalysisActionResponse:
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
def recompute_photo_analysis(
    photo_id: str,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> PhotoAnalysisActionResponse:
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> PhotoMetadataActionResponse:
    photo = db.execute(select(Photo).where(Photo.id == photo_id)).scalar_one_or_none()
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke bilde")

    user_tags: list[str]
    system_tags: list[str]
    try:
        user_tags, system_tags = _parse_stored_tags(photo)
    except Exception:  # noqa: BLE001
        user_tags = []
        system_tags = []

    if payload.tags is not None:
        user_tags = _validate_user_tags_payload(payload.tags)

    if payload.caption is not None:
        cleaned_caption = payload.caption.strip()
        photo.notes = cleaned_caption if cleaned_caption else None

    if payload.needs_manual_qc is not None:
        system_tags = set_quality_flag(system_tags, "qc:needs_manual_qc", payload.needs_manual_qc)

    if "manual_view_lat" in payload.model_fields_set or "manual_view_lng" in payload.model_fields_set:
        if "manual_view_lat" not in payload.model_fields_set or "manual_view_lng" not in payload.model_fields_set:
            raise HTTPException(status_code=400, detail="Både manual_view_lat og manual_view_lng må sendes sammen")
        try:
            system_tags = set_manual_view_override(system_tags, payload.manual_view_lat, payload.manual_view_lng)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))

    if "altitude_m" in payload.model_fields_set:
        photo.altitude_m = _validate_numeric_override(
            "altitude_m",
            payload.altitude_m,
            min_value=_METADATA_ALTITUDE_MIN_M,
            max_value=_METADATA_ALTITUDE_MAX_M,
        )
    if "heading_deg" in payload.model_fields_set:
        photo.heading_deg = _validate_numeric_override(
            "heading_deg",
            payload.heading_deg,
            min_value=_METADATA_HEADING_MIN_DEG,
            max_value=_METADATA_HEADING_MAX_DEG,
        )
    if "pitch_deg" in payload.model_fields_set:
        photo.pitch_deg = _validate_numeric_override(
            "pitch_deg",
            payload.pitch_deg,
            min_value=_METADATA_PITCH_MIN_DEG,
            max_value=_METADATA_PITCH_MAX_DEG,
        )

    photo.tags_json = serialize_tag_groups(user_tags=user_tags, system_tags=system_tags)
    tags = merge_tag_groups(user_tags, system_tags)

    needs_manual_qc = "qc:needs_manual_qc" in system_tags
    manual_view_lat = extract_meta_float(system_tags, "meta:manual_view_lat")
    manual_view_lng = extract_meta_float(system_tags, "meta:manual_view_lng")

    db.commit()
    db.refresh(photo)

    return PhotoMetadataActionResponse(
        status="ok",
        photo_id=photo.id,
        tags=tags,
        user_tags=user_tags,
        system_tags=system_tags,
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
    _admin_session=Depends(require_admin_session),
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

    return await _build_gardskart_job_response(db, property_obj, force_refresh=force_refresh)


@router.get("/properties/{property_id}/gardskart-job", response_model=GardskartJobResponse)
async def get_property_gardskart_job(
    property_id: int,
    force_refresh: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> GardskartJobResponse:
    user = _current_user(db)
    property_obj = _active_property_by_id(db, user.id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")

    return await _build_gardskart_job_response(db, property_obj, force_refresh=force_refresh)


@router.post("/imports/photos")
def post_import_photos(
    payload: ImportRequest = Body(default_factory=ImportRequest),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> dict:
    source = Path(payload.source_path) if payload.source_path else settings.imports_default_source
    run = run_photo_ingest(db, source)
    return {"import_run": ImportRunOut.model_validate(run)}


@router.get("/imports/{run_id}")
def get_import_run(run_id: int, _admin_session=Depends(require_admin_session), db: Session = Depends(get_db)) -> dict:
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
