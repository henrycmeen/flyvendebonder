from __future__ import annotations

import json
import logging
import math
import os
import time
from datetime import timedelta, timezone
from datetime import date as date_type, datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, HTMLResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import get_db
from ..logging_utils import read_recent_logs, request_id_ctx
from ..models import (
    FarmMembership,
    FieldPlot,
    FlightCapture,
    FlightMission,
    IngestRun,
    MediaStagingJob,
    PlanningUnit,
    Photo,
    PhotoAsset,
    PhotoAnalysis,
    ProcessingArtifact,
    ProcessingRun,
    Property,
    ScoutingTask,
    User,
)
from ..schemas import (
    AdminLoginRequest,
    AdminSessionStatusResponse,
    BackendLogLine,
    BackendLogsResponse,
    FieldCandidateListResponse,
    FlightCaptureCreate,
    FlightCaptureListResponse,
    FlightCaptureOut,
    FlightMissionCreate,
    FlightMissionListResponse,
    FlightMissionOut,
    FlightMissionPatch,
    FlightMissionPreviewOut,
    FieldPlotCreate,
    FieldPlotDeleteResponse,
    FieldHistoryEntryOut,
    FieldHistoryOut,
    FieldReportOut,
    FieldReportPhotoOut,
    FieldReportPropertyOut,
    FieldReportSummaryOut,
    FieldPlotListResponse,
    FieldPlotOut,
    FieldPlotPatch,
    GardskartJobResponse,
    PhotoAnalysisActionResponse,
    PhotoAssetListResponse,
    PhotoAssetOut,
    ProcessingArtifactCreate,
    ProcessingArtifactListResponse,
    ProcessingArtifactOut,
    ProcessingRunCreate,
    ProcessingRunListResponse,
    ProcessingRunOut,
    ProcessingRunPatch,
    PhotoMetadataActionResponse,
    PhotoMetadataPatchRequest,
    PhotoAnalysisRefreshResponse,
    PhotoReprocessResponse,
    OrthophotoColorSampleResponse,
    SourceLayerStatus,
    SourceStatusResponse,
    StacAsset,
    StacCollectionListResponse,
    StacCollectionOut,
    StacItemCollectionOut,
    StacItemOut,
    StacLink,
    ImportRequest,
    ImportRunOut,
    MediaStagingCountsOut,
    MediaStagingEnvelope,
    MediaFinalizeEnvelope,
    MediaFinalizeResultOut,
    MediaStagingItemOut,
    MediaStagingJobListResponse,
    MediaStagingJobOut,
    DroneProfileListResponse,
    DroneProfileOut,
    PlanningUnitListResponse,
    PlanningUnitOut,
    PlanningUnitSplitIn,
    PlanningUnitSplitOut,
    PlanningUnitSyncResponse,
    PlanningPointResolveIn,
    PlanningPointResolveOut,
    OperatingAreaConfirmIn,
    OperatingAreaConfirmOut,
    OperatingAreaPointIn,
    OperatingAreaPreviewOut,
    ScoutingTaskCreate,
    ScoutingTaskListResponse,
    ScoutingTaskOut,
    ScoutingTaskPatch,
    ScoutingTaskStatus,
    PhotoFeature,
    PhotoPageResponse,
    PhotoResponse,
    ProfileOut,
    ProfilePatchRequest,
    PropertyOut,
    TimelineDateEntry,
    TimelineResponse,
    UserOut,
    VideoJobEnvelope,
    VideoJobListResponse,
    VideoJobOut,
    VideoJobReviewIn,
    VideoJobReviewOut,
)
from ..services.admin_access import (
    AdminSession,
    admin_access_code_is_configured,
    admin_access_is_configured,
    admin_access_is_open,
    clear_admin_session,
    enforce_login_rate_limit,
    get_admin_session,
    issue_admin_session,
    register_failed_login,
    require_admin_session,
    reset_login_attempts,
    verify_admin_access_code,
)
from ..services.access_control import ACTIVE_MEMBERSHIP_STATUS, roles_with_farm_capability
from ..services.pilot_identity import PilotIdentityConfigurationError, resolve_pilot_owner
from ..services.operating_areas import candidate_payload as operating_area_candidate_payload
from ..services.operating_area_identity import candidate_id as operating_area_candidate_id
from ..services.operating_area_identity import candidate_source_key as operating_area_source_key
from ..services.operating_area_identity import candidate_with_property_identity
from ..services.gardskart import get_job_id
from ..services.geonorge_teiger import (
    list_field_candidates_for_property,
    lookup_field_candidates_by_point,
    lookup_field_candidates_by_point_any,
)
from ..services.imports import ImportSelectionError, run_photo_ingest
from ..services.media_staging import (
    StagingUploadTooLarge,
    staging_source_paths,
    create_media_staging_job as create_media_staging_job_record,
    finalize_media_staging_job as finalize_media_staging_job_record,
    get_media_staging_job as get_media_staging_job_record,
    list_media_staging_jobs as list_media_staging_jobs_record,
)
from ..services.orthophoto_sampling import (
    OrthophotoNoData,
    OrthophotoNotFound,
    OrthophotoPointOutsideBounds,
    OrthophotoSamplingError,
    OrthophotoSourceUnavailable,
    sample_orthophoto_color,
)
from ..services.analysis_enrich import enrich_photo, rebuild_photo_analysis_for_user
from ..services.field_reports import render_field_report_html
from ..services.field_plots import normalize_polygon_coordinates, polygon_area_m2
from ..services.flight_missions import (
    EXPORT_DJI_FLY_KMZ_FORMAT,
    EXPORT_DJI_WPML_FORMAT,
    build_flight_mission_dji_fly_kmz,
    build_flight_mission_export_bundle,
    build_flight_mission_dji_wpml_kmz,
    build_flight_mission_payload,
)
from ..services.planning import (
    create_field_from_candidate,
    ensure_active_planning_unit_for_field,
    field_source_provenance,
    find_field_for_candidate,
    find_field_plot_for_geometry,
    get_drone_profile,
    list_drone_profiles,
    normalize_source_provenance,
    planning_unit_field_name,
    source_provenance_from_candidate,
    planning_unit_payload_from_field,
    planning_unit_payload_from_unit,
    refresh_imported_field_from_candidate,
    refresh_root_planning_unit_from_field,
    split_planning_unit,
    sync_fields_from_candidates,
    sync_planning_units,
)
from ..services.photo_reprocess import reprocess_photos_for_user
from ..services.photos import load_photo_by_id, load_photos_for_date, load_photos_page, timeline_dates
from ..services.processing import (
    artifact_public_url,
    build_capture_summary,
    build_capture_photo_summary,
    build_processing_input_manifest,
    processing_provider_profile,
    processing_run_should_finish,
    processing_run_should_start,
)
from ..services.stac import (
    STAC_COLLECTION_LICENSE,
    STAC_ITEM_ASSETS,
    STAC_PROJECTION_EXTENSION,
    STAC_VERSION,
    geometry_bbox,
    _normalize_bbox_values,
    processing_run_temporal,
    stac_asset_key,
    stac_bbox_to_geometry,
    stac_collection_description,
    stac_collection_id,
    stac_collection_title,
    stac_item_id,
    union_bboxes,
)
from ..services.tag_utils import (
    extract_meta_float,
    normalize_user_tags,
    parse_tag_groups,
    set_quality_flag,
    serialize_tag_groups,
    merge_tag_groups,
)
from ..services.video_jobs import (
    create_video_job as create_video_job_record,
    get_video_job as get_video_job_record,
    job_dir as video_job_dir,
    list_video_jobs as list_video_job_records,
    save_video_job_review,
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
_VIDEO_JOB_ARTIFACT_MEDIA_TYPES = {
    "preview.jpg": "image/jpeg",
    "geodata.geojson": "application/geo+json",
    "metadata.json": "application/json",
}
_GEOJSON_CONTRACT_NAME = "flyvendebonder.geojson"
_GEOJSON_CONTRACT_VERSION = "v1"


def _owner_user_for_session(db: Session, session: AdminSession) -> User:
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Sesjonen tilhører en ukjent bruker")

    active_owner = (
        db.execute(
            select(FarmMembership.id)
            .where(FarmMembership.user_id == user.id)
            .where(FarmMembership.role == "owner")
            .where(FarmMembership.status == "active")
            .limit(1)
        )
        .scalars()
        .first()
    )
    if active_owner is None:
        raise HTTPException(status_code=403, detail="Aktivt eiermedlemskap kreves")
    return user


def _request_owner_user(
    request: Request,
    db: Session = Depends(get_db),
) -> User:
    if admin_access_is_open():
        return _pilot_owner_for_login(db)
    session = require_admin_session(request)
    return _owner_user_for_session(db, session)


def _session_user_id(user: User, requested_user_id: int | None) -> int:
    if requested_user_id is not None and requested_user_id != user.id:
        raise HTTPException(status_code=403, detail="Kan ikke velge en annen bruker enn sesjonsidentiteten")
    return user.id


def _pilot_owner_for_login(db: Session) -> User:
    try:
        user = resolve_pilot_owner(db)
    except PilotIdentityConfigurationError as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc),
        ) from exc
    if user is None:
        raise HTTPException(status_code=503, detail="Pilotinnlogging krever en aktiv eier")
    return user


def _require_pilot_admin_identity(db: Session, user: User) -> None:
    pilot_user = _pilot_owner_for_login(db)
    if pilot_user.id != user.id:
        raise HTTPException(status_code=403, detail="Backendlogger krever pilotadministrator")


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


def _active_writable_farm_id_for_user(
    db: Session,
    user_id: int,
    *,
    farm_id: int | None = None,
) -> int:
    writable_roles = roles_with_farm_capability("field.write")
    statement = (
        select(FarmMembership.farm_id)
        .where(FarmMembership.user_id == user_id)
        .where(FarmMembership.status == "active")
        .where(FarmMembership.role.in_(writable_roles))
        .order_by(FarmMembership.id)
    )
    if farm_id is not None:
        statement = statement.where(FarmMembership.farm_id == farm_id)

    writable_farm_id = (
        db.execute(statement)
        .scalars()
        .first()
    )
    if writable_farm_id is None:
        raise HTTPException(status_code=403, detail="Brukeren mangler skrivbart gårdsmedlemskap")
    return writable_farm_id


def _ensure_user_property(
    db: Session,
    *,
    user_id: int,
    komm: str,
    gnr: int,
    bnr: int,
    fnr: int = 0,
    label: str | None = None,
) -> tuple[Property, bool]:
    item = (
        db.execute(
            select(Property).where(
                Property.user_id == user_id,
                Property.komm == komm,
                Property.gnr == gnr,
                Property.bnr == bnr,
                Property.fnr == fnr,
            )
        )
        .scalars()
        .first()
    )
    if item is not None:
        changed = False
        if item.active_to is not None:
            item.active_to = None
            changed = True
        if item.active_from is None:
            item.active_from = date_type.today()
            changed = True
        if label and not item.label:
            item.label = label
            changed = True
        if changed:
            db.flush()
        return item, False

    item = Property(
        user_id=user_id,
        farm_id=_active_writable_farm_id_for_user(db, user_id),
        komm=komm,
        gnr=gnr,
        bnr=bnr,
        fnr=fnr,
        label=label,
        active_from=date_type.today(),
        active_to=None,
    )
    db.add(item)
    db.flush()
    return item, True


def _profile_out(db: Session, user: User, *, include_private_contact: bool = True) -> ProfileOut:
    properties = _active_properties(db, user.id)
    current = properties[0] if properties else None
    additional = properties[1:] if len(properties) > 1 else []
    user_out = UserOut.model_validate(user)
    if not include_private_contact:
        user_out = user_out.model_copy(
            update={
                "phone": None,
                "email": None,
                "address_line1": None,
                "postal_code": None,
                "city": None,
            }
        )
    return ProfileOut(
        user=user_out,
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
    if not settings.nibio_gardskart_enabled:
        return GardskartJobResponse(
            property_id=property_obj.id,
            source="disabled",
            status_desc="Gårdskart er deaktivert i dette miljøet.",
            is_expired=False,
        )

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


def _configured_layer(url_wms: str, layers_wms: str, url_wfs: str = "", layers_wfs: str = "") -> bool:
    return bool((url_wms and layers_wms) or (url_wfs and layers_wfs))


def _source_layer_status(*, enabled: bool, configured: bool, enabled_desc: str, disabled_desc: str) -> SourceLayerStatus:
    return SourceLayerStatus(
        enabled=enabled,
        configured=configured,
        source="enabled" if enabled else "disabled",
        status_desc=enabled_desc if enabled else disabled_desc,
    )


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


def _require_active_property(db: Session, user_id: int, property_id: int | None) -> Property:
    if property_id is None:
        return _require_current_property(db, user_id)
    property_obj = _active_property_by_id(db, user_id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")
    return property_obj


def _farm_capability_membership_conditions(
    *,
    user_id: int,
    capability: str,
) -> tuple[Any, ...]:
    return (
        FarmMembership.user_id == user_id,
        FarmMembership.status == ACTIVE_MEMBERSHIP_STATUS,
        FarmMembership.role.in_(roles_with_farm_capability(capability)),
    )


def _require_active_property_for_capability(
    db: Session,
    *,
    user_id: int,
    property_id: int | None,
    capability: str,
) -> Property:
    today = date_type.today()
    statement = (
        select(Property)
        .join(FarmMembership, FarmMembership.farm_id == Property.farm_id)
        .where(
            (Property.active_from.is_(None)) | (Property.active_from <= today),
            (Property.active_to.is_(None)) | (Property.active_to >= today),
            *_farm_capability_membership_conditions(
                user_id=user_id,
                capability=capability,
            ),
        )
    )
    if property_id is None:
        statement = statement.where(Property.user_id == user_id).order_by(Property.id)
    else:
        statement = statement.where(Property.id == property_id)

    property_obj = db.execute(statement).scalars().first()
    if property_obj is None:
        status_code = 400 if property_id is None else 404
        detail = "Ingen aktiv eiendom er valgt" if property_id is None else "Fant ikke aktiv eiendom"
        raise HTTPException(status_code=status_code, detail=detail)
    return property_obj


def _active_property_ids(db: Session, user_id: int) -> list[int]:
    return [item.id for item in _active_properties(db, user_id)]


def _require_user_field_plot(db: Session, *, user_id: int, field_id: int) -> FieldPlot:
    property_ids = _active_property_ids(db, user_id)
    item = (
        db.execute(select(FieldPlot).where(FieldPlot.id == field_id, FieldPlot.property_id.in_(property_ids or [-1])))
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke jordutkast")
    return item


def _require_field_plot_for_capability(
    db: Session,
    *,
    user_id: int,
    field_id: int,
    capability: str,
) -> FieldPlot:
    today = date_type.today()
    item = (
        db.execute(
            select(FieldPlot)
            .join(Property, Property.id == FieldPlot.property_id)
            .join(FarmMembership, FarmMembership.farm_id == Property.farm_id)
            .where(
                FieldPlot.id == field_id,
                (Property.active_from.is_(None)) | (Property.active_from <= today),
                (Property.active_to.is_(None)) | (Property.active_to >= today),
                *_farm_capability_membership_conditions(
                    user_id=user_id,
                    capability=capability,
                ),
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke jordutkast")
    return item


def _require_user_flight_mission(db: Session, *, user_id: int, mission_id: int) -> FlightMission:
    property_ids = _active_property_ids(db, user_id)
    item = (
        db.execute(
            select(FlightMission).where(
                FlightMission.id == mission_id,
                FlightMission.property_id.in_(property_ids or [-1]),
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")
    return item


def _require_user_planning_unit(db: Session, *, user_id: int, unit_id: int) -> PlanningUnit:
    property_ids = _active_property_ids(db, user_id)
    item = (
        db.execute(
            select(PlanningUnit).where(
                PlanningUnit.id == unit_id,
                PlanningUnit.property_id.in_(property_ids or [-1]),
                PlanningUnit.status == "active",
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv planenhet")
    return item


def _require_user_scouting_task(db: Session, *, user_id: int, task_id: int) -> ScoutingTask:
    property_ids = _active_property_ids(db, user_id)
    item = (
        db.execute(
            select(ScoutingTask).where(
                ScoutingTask.id == task_id,
                ScoutingTask.property_id.in_(property_ids or [-1]),
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke feltoppgave")
    return item


def _normalize_field_name(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _media_staging_job_out(job: MediaStagingJob) -> MediaStagingJobOut:
    source_paths = staging_source_paths(settings.app_data_root, job)
    finalize_result = None
    if job.status == "finalized":
        try:
            finalize_result = MediaFinalizeResultOut.model_validate_json(job.finalize_result_json)
            if finalize_result.job_id != job.id or finalize_result.status != "finalized":
                finalize_result = None
        except ValueError:
            # Legacy or corrupt cached data must not break listing/recovery.
            pass
    items = [
        MediaStagingItemOut(
            id=item.id,
            filename=item.filename,
            source_path=source_paths.get(item.item_order),
            mime=item.mime,
            bytes=item.bytes,
            checksum=item.checksum,
            media_kind=item.media_kind,
            status=item.status,
            error_detail=item.error_detail,
        )
        for item in job.items
    ]
    counts = MediaStagingCountsOut(
        total=len(items),
        image_count=sum(1 for item in items if item.media_kind == "image"),
        video_count=sum(1 for item in items if item.media_kind == "video"),
        unknown_count=sum(1 for item in items if item.media_kind == "unknown"),
        rejected_count=sum(1 for item in items if item.status == "rejected"),
    )
    return MediaStagingJobOut(
        finalize_result=finalize_result,
        job_id=job.id,
        source=job.source,
        status=job.status,
        counts=counts,
        items=items,
        created_at=job.created_at.replace(tzinfo=timezone.utc) if job.created_at.tzinfo is None else job.created_at,
        updated_at=job.updated_at.replace(tzinfo=timezone.utc) if job.updated_at.tzinfo is None else job.updated_at,
    )


def _require_media_staging_job(db: Session, *, user_id: int, job_id: str) -> MediaStagingJob:
    job = get_media_staging_job_record(db, user_id=user_id, job_id=job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Fant ikke stagingjobb")
    return job


def _video_job_out(job) -> VideoJobOut:
    review_payload = None
    if job.review is not None:
        review_payload = {
            "job_id": job.review.job_id,
            "created_at": job.review.created_at,
            "mode": job.review.mode,
            "review_state": job.review.review_state,
            "placement": json.loads(job.review.placement_json) if job.review.placement_json else None,
            "reviewed_at": job.review.reviewed_at,
        }
    result_frames = json.loads(job.result_frames_json)
    result_map3d = {
        "stitch_job_id": job.id,
        "preview_image": f"/api/v1/video-jobs/{job.id}/preview.jpg",
        "mesh_url": None,
        "geodata_geojson": f"/api/v1/video-jobs/{job.id}/geodata.geojson",
        "metadata_json": f"/api/v1/video-jobs/{job.id}/metadata.json",
        "epsg": "EPSG:4326",
    }
    return VideoJobOut.model_validate(
        {
            "job_id": job.id,
            "filename": job.filename,
            "mode": job.mode,
            "status": job.status,
            "created_at": job.created_at,
            "updated_at": job.updated_at,
            "message": job.message,
            "config": json.loads(job.config_json),
            "result_frames": result_frames,
            "result_map3d": result_map3d,
            "result": result_frames,
            "review": review_payload,
        }
    )


def _require_video_job(db: Session, *, user_id: int, job_id: str):
    job = get_video_job_record(db, job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(status_code=404, detail="Fant ikke videojobb")
    return job


def _video_job_artifact_path(job_id: str, artifact_name: str) -> Path:
    return video_job_dir(settings.app_data_root, job_id) / artifact_name


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
        source_provenance=field_source_provenance(item),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _planning_unit_out(
    item: PlanningUnit,
    *,
    source_field_name: str,
    source_field_source: str = "manual",
    source_field_status: str = "draft",
    source_field_provenance: dict[str, Any] | None = None,
    latest_mission_id: int | None = None,
    latest_mission_name: str | None = None,
    latest_duration_status: str | None = None,
    latest_estimated_duration_s: float | None = None,
) -> PlanningUnitOut:
    area_m2 = round(item.area_m2, 2) if item.area_m2 is not None else None
    return PlanningUnitOut(
        id=item.id,
        property_id=item.property_id,
        source_field_plot_id=item.source_field_plot_id,
        parent_unit_id=item.parent_unit_id,
        name=(item.name or f"Planenhet {item.id}").strip(),
        status=item.status,
        geometry=json.loads(item.geometry_json),
        area_m2=area_m2,
        area_ha=round(area_m2 / 10_000, 4) if area_m2 is not None else None,
        source_field_name=source_field_name,
        source_field_source=source_field_source,
        source_field_status=source_field_status,
        source_field_provenance=source_field_provenance or {},
        is_split=item.parent_unit_id is not None,
        latest_mission_id=latest_mission_id,
        latest_mission_name=latest_mission_name,
        latest_duration_status=latest_duration_status,
        latest_estimated_duration_s=latest_estimated_duration_s,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _scouting_task_out(item: ScoutingTask) -> ScoutingTaskOut:
    try:
        photo_ids = json.loads(item.photo_ids_json or "[]")
    except (TypeError, json.JSONDecodeError):
        photo_ids = []
    observed_at = item.observed_at
    if observed_at is not None:
        observed_at = (
            observed_at.replace(tzinfo=timezone.utc)
            if observed_at.tzinfo is None
            else observed_at.astimezone(timezone.utc)
        )
    return ScoutingTaskOut(
        id=item.id,
        property_id=item.property_id,
        field_id=item.field_plot_id,
        planning_unit_id=item.planning_unit_id,
        title=item.title,
        notes=item.notes,
        status=item.status,
        priority=item.priority,
        observed_at=observed_at,
        observed_at_original_offset=item.observed_at_original_offset,
        position={"lat": item.lat, "lng": item.lng},
        photo_ids=[str(photo_id) for photo_id in photo_ids if str(photo_id).strip()],
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _normalize_scouting_observed_at(value: datetime) -> tuple[datetime, str]:
    offset = value.utcoffset()
    if offset is None:
        raise ValueError("Observasjonstidspunkt må inneholde tidssone-offset")
    offset_minutes = int(offset.total_seconds() // 60)
    sign = "+" if offset_minutes >= 0 else "-"
    absolute_minutes = abs(offset_minutes)
    original_offset = f"{sign}{absolute_minutes // 60:02d}:{absolute_minutes % 60:02d}"
    normalized_utc = value.astimezone(timezone.utc).replace(tzinfo=None)
    return normalized_utc, original_offset


def _validate_scouting_position(position) -> tuple[float, float]:
    lat = float(position.lat)
    lng = float(position.lng)
    if not math.isfinite(lat) or not math.isfinite(lng):
        raise HTTPException(status_code=400, detail="Posisjon må være gyldig bredde- og lengdegrad")
    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        raise HTTPException(status_code=400, detail="Posisjon må være innenfor gyldige koordinater")
    return lat, lng


def _resolve_scouting_scope(
    db: Session,
    *,
    user_id: int,
    field_id: int,
    property_id: int | None,
    planning_unit_id: int | None,
) -> tuple[Property, FieldPlot, PlanningUnit | None]:
    field = _require_user_field_plot(db, user_id=user_id, field_id=field_id)
    if property_id is not None and property_id != field.property_id:
        raise HTTPException(status_code=400, detail="Feltet tilhører ikke valgt eiendom")
    property_obj = _require_active_property(db, user_id, field.property_id)
    planning_unit = None
    if planning_unit_id is not None:
        planning_unit = _require_user_planning_unit(db, user_id=user_id, unit_id=planning_unit_id)
        if planning_unit.property_id != property_obj.id or planning_unit.source_field_plot_id != field.id:
            raise HTTPException(status_code=400, detail="Planenheten tilhører ikke valgt felt")
    return property_obj, field, planning_unit


def _resolve_scouting_photo_ids(
    db: Session,
    *,
    user_id: int,
    property_obj: Property,
    photo_ids: list[str],
) -> list[str]:
    if not photo_ids:
        return []

    photo_items = (
        db.execute(
            select(Photo)
            .where(Photo.user_id == user_id)
            .where(Photo.id.in_(photo_ids))
            .order_by(Photo.captured_at.asc(), Photo.id.asc())
        )
        .scalars()
        .all()
    )
    photo_by_id = {item.id: item for item in photo_items}
    missing_ids = [photo_id for photo_id in photo_ids if photo_id not in photo_by_id]
    if missing_ids:
        raise HTTPException(status_code=400, detail=f"Fant ikke valgte bilder: {missing_ids}")

    wrong_property = [photo_id for photo_id in photo_ids if photo_by_id[photo_id].property_id != property_obj.id]
    if wrong_property:
        raise HTTPException(
            status_code=400,
            detail=f"Alle bilder på en feltoppgave må tilhøre valgt eiendom: {wrong_property}",
        )
    return photo_ids


def _field_ids_contains(raw_value: str, field_id: int) -> bool:
    return field_id in {int(value) for value in json.loads(raw_value)}


def _planning_unit_ids_contains(raw_value: str, planning_unit_id: int) -> bool:
    return planning_unit_id in {int(value) for value in json.loads(raw_value)}


def _history_season_label(value: datetime) -> str:
    return str(value.year)


def _processing_artifact_kinds(item: ProcessingRun) -> list[str]:
    kinds: list[str] = []
    for artifact in item.artifacts:
        if artifact.kind not in kinds:
            kinds.append(artifact.kind)
    return kinds


def _field_history_entries(
    *,
    field: FieldPlot,
    missions: list[FlightMission],
    captures: list[FlightCapture],
) -> list[FieldHistoryEntryOut]:
    entries: list[FieldHistoryEntryOut] = []

    for mission in missions:
        warnings = json.loads(mission.warnings_json)
        field_count = len(json.loads(mission.field_ids_json))
        entries.append(
            FieldHistoryEntryOut(
                kind="mission",
                occurred_at=mission.last_generated_at,
                season=_history_season_label(mission.last_generated_at),
                title=(mission.name or f"Oppdrag {mission.id}").strip(),
                status=mission.status,
                summary=f"{field_count} felt i oppdraget, {len(warnings)} advarsler",
                mission_id=mission.id,
            )
        )

    for capture in captures:
        capture_timestamp = capture.captured_to or capture.captured_from or capture.created_at
        entries.append(
            FieldHistoryEntryOut(
                kind="capture",
                occurred_at=capture_timestamp,
                season=_history_season_label(capture_timestamp),
                title=(capture.name or f"Capture {capture.id}").strip(),
                status=capture.status,
                summary=f"{capture.photo_count} bilder i capture",
                mission_id=capture.mission_id,
                capture_id=capture.id,
                source=capture.source,
                photo_count=capture.photo_count,
            )
        )
        for run in capture.processing_runs:
            run_timestamp = run.finished_at or run.started_at or run.created_at
            artifact_kinds = _processing_artifact_kinds(run)
            entries.append(
                FieldHistoryEntryOut(
                    kind="processing_run",
                    occurred_at=run_timestamp,
                    season=_history_season_label(run_timestamp),
                    title=f"Processing run {run.id}",
                    status=run.status,
                    summary=f"{run.provider} med {len(run.artifacts)} artefakter",
                    mission_id=capture.mission_id,
                    capture_id=capture.id,
                    processing_run_id=run.id,
                    provider=run.provider,
                    artifact_count=len(run.artifacts),
                    artifact_kinds=artifact_kinds,
                )
            )

    return sorted(
        entries,
        key=lambda item: (item.occurred_at, item.processing_run_id or 0, item.capture_id or 0, item.mission_id or 0),
        reverse=True,
    )


def _field_history_records(
    db: Session,
    *,
    property_id: int,
    field_id: int,
) -> tuple[list[FlightMission], list[FlightCapture], list[ProcessingRun]]:
    missions = (
        db.execute(
            select(FlightMission)
            .where(FlightMission.property_id == property_id)
            .order_by(FlightMission.last_generated_at.desc(), FlightMission.id.desc())
        )
        .scalars()
        .all()
    )
    field_missions = [item for item in missions if _field_ids_contains(item.field_ids_json, field_id)]

    captures = (
        db.execute(
            select(FlightCapture)
            .options(selectinload(FlightCapture.processing_runs).selectinload(ProcessingRun.artifacts))
            .where(FlightCapture.property_id == property_id)
            .order_by(FlightCapture.updated_at.desc(), FlightCapture.id.desc())
        )
        .scalars()
        .all()
    )
    field_captures = [item for item in captures if _field_ids_contains(item.field_ids_json, field_id)]
    processing_runs = [run for capture in field_captures for run in capture.processing_runs]
    return field_missions, field_captures, processing_runs


def _build_field_report(db: Session, *, user_id: int, field_id: int) -> FieldReportOut:
    property_ids = _active_property_ids(db, user_id)
    field = (
        db.execute(
            select(FieldPlot).where(
                FieldPlot.id == field_id,
                FieldPlot.property_id.in_(property_ids or [-1]),
            )
        )
        .scalars()
        .first()
    )
    if field is None:
        raise HTTPException(status_code=404, detail="Fant ikke felt")
    property_obj = _active_property_by_id(db, user_id, field.property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke felt")

    missions, captures, processing_runs = _field_history_records(
        db,
        property_id=field.property_id,
        field_id=field.id,
    )
    history = _field_history_entries(field=field, missions=missions, captures=captures)

    finding_records = (
        db.execute(
            select(ScoutingTask)
            .where(
                ScoutingTask.property_id == field.property_id,
                ScoutingTask.field_plot_id == field.id,
            )
            .order_by(ScoutingTask.created_at.desc(), ScoutingTask.id.desc())
        )
        .scalars()
        .all()
    )
    findings = [_scouting_task_out(item) for item in finding_records]

    linked_photo_ids: list[str] = []
    for finding in findings:
        for photo_id in finding.photo_ids:
            if photo_id not in linked_photo_ids:
                linked_photo_ids.append(photo_id)
    available_photos = (
        db.execute(
            select(Photo)
            .options(selectinload(Photo.assets))
            .where(
                Photo.user_id == user_id,
                Photo.property_id == field.property_id,
                Photo.id.in_(linked_photo_ids or [""]),
            )
        )
        .scalars()
        .all()
    )
    photos_by_id = {photo.id: photo for photo in available_photos}
    key_photos: list[FieldReportPhotoOut] = []
    for photo_id in linked_photo_ids:
        photo = photos_by_id.get(photo_id)
        if photo is None:
            continue
        assets_by_kind = {asset.kind: asset for asset in photo.assets}
        web_asset = assets_by_kind.get("web") or assets_by_kind.get("original")
        if web_asset is None:
            continue
        thumbnail_asset = assets_by_kind.get("thumb") or assets_by_kind.get("web") or web_asset
        key_photos.append(
            FieldReportPhotoOut(
                id=photo.id,
                thumbnail_url=f"/api/v1/assets/{thumbnail_asset.path}",
                web_url=f"/api/v1/assets/{web_asset.path}",
            )
        )

    completed_processing_runs = [run for run in processing_runs if run.status == "completed"]
    artifact_kinds = sorted(
        {
            artifact.kind
            for processing_run in completed_processing_runs
            for artifact in processing_run.artifacts
        }
    )
    delivery_count = sum(
        1 for processing_run in completed_processing_runs if processing_run.artifacts
    )
    field_name = (field.name or "").strip() or f"Felt {field.id}"

    return FieldReportOut(
        title=f"Feltrapport – {field_name}",
        generated_at=datetime.now(timezone.utc),
        property=FieldReportPropertyOut(
            id=property_obj.id,
            label=property_obj.label,
            komm=property_obj.komm,
            gnr=property_obj.gnr,
            bnr=property_obj.bnr,
            fnr=property_obj.fnr,
        ),
        field=_field_plot_out(field),
        summary=FieldReportSummaryOut(
            mission_count=len(missions),
            capture_count=len(captures),
            processing_run_count=len(processing_runs),
            delivery_count=delivery_count,
            finding_count=len(findings),
            open_finding_count=sum(1 for finding in findings if finding.status != "done"),
            key_photo_count=len(key_photos),
            artifact_kinds=artifact_kinds,
        ),
        findings=findings,
        key_photos=key_photos,
        history=history,
        limitations=[
            "Feltfunn bygger på manuelt registrerte scouting-oppgaver og er ikke en agronomisk fasit.",
            "Rapporten viser data som var tilgjengelige da den ble generert; senere endringer inngår ikke.",
        ],
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


def _field_candidate_response(property_id: int, fields: list[dict]) -> FieldCandidateListResponse:
    return FieldCandidateListResponse(property_id=property_id, count=len(fields), fields=fields)


def _geojson_contract_metadata(*, resource: str, export_path: str, import_paths: list[str]) -> dict[str, object]:
    return {
        "name": _GEOJSON_CONTRACT_NAME,
        "version": _GEOJSON_CONTRACT_VERSION,
        "resource": resource,
        "coordinate_reference_system": "OGC:CRS84",
        "coordinate_order": "longitude_latitude",
        "export_path": export_path,
        "import_paths": import_paths,
        "stac_note": "STAC brukes separat for raster- og flight-artefakter i HEN-55.",
    }


def _geojson_response(
    *,
    resource: str,
    export_path: str,
    import_paths: list[str],
    features: list[dict],
    extra: dict[str, object] | None = None,
) -> Response:
    payload: dict[str, object] = {
        "type": "FeatureCollection",
        "features": features,
        "flyvendebonder_contract": _geojson_contract_metadata(
            resource=resource,
            export_path=export_path,
            import_paths=import_paths,
        ),
    }
    if extra:
        payload.update(extra)
    return Response(
        content=json.dumps(payload, ensure_ascii=False),
        media_type="application/geo+json",
    )


def _flight_mission_out(item: FlightMission) -> FlightMissionOut:
    export_manifest = json.loads(item.export_manifest_json)
    summary = export_manifest.get("summary", {}) if isinstance(export_manifest, dict) else {}
    return FlightMissionOut(
        id=item.id,
        property_id=item.property_id,
        name=(item.name or f"Oppdrag {item.id}").strip(),
        status=item.status,
        field_ids=json.loads(item.field_ids_json),
        planning_unit_ids=json.loads(item.planning_unit_ids_json),
        drone_profile_id=item.drone_profile_id,
        drone_profile_snapshot=json.loads(item.drone_profile_snapshot_json),
        estimated_duration_s=item.estimated_duration_s if item.estimated_duration_s is not None else summary.get("estimated_duration_s"),
        duration_status=item.duration_status or summary.get("duration_status"),
        parameters=json.loads(item.parameters_json),
        fields=json.loads(item.field_snapshots_json),
        warnings=json.loads(item.warnings_json),
        route_geojson=json.loads(item.route_geojson_json),
        export_manifest=export_manifest,
        created_at=item.created_at,
        updated_at=item.updated_at,
        last_generated_at=item.last_generated_at,
    )


def _flight_mission_preview_out(payload: dict[str, object]) -> FlightMissionPreviewOut:
    return FlightMissionPreviewOut(
        name=str(payload["name"]),
        status=str(payload["status"]),
        field_ids=list(payload["field_ids"]),
        planning_unit_ids=list(payload.get("planning_unit_ids", [])),
        drone_profile_id=payload.get("drone_profile_id"),
        drone_profile_snapshot=dict(payload.get("drone_profile_snapshot", {})),
        estimated_duration_s=payload.get("estimated_duration_s"),
        duration_status=payload.get("duration_status"),
        parameters=payload["parameters"],
        fields=payload["fields"],
        warnings=payload["warnings"],
        route_geojson=payload["route_geojson"],
        export_manifest=payload["export_manifest"],
    )


def _flight_capture_out(db: Session, item: FlightCapture) -> FlightCaptureOut:
    photo_ids = json.loads(item.photo_ids_json)
    photo_summary = {
        "first_photo_id": photo_ids[0] if photo_ids else None,
        "last_photo_id": photo_ids[-1] if photo_ids else None,
        "is_contiguous": True,
    }
    if photo_ids:
        photo_items = (
            db.execute(select(Photo).where(Photo.id.in_(photo_ids)).order_by(Photo.captured_at.asc(), Photo.id.asc()))
            .scalars()
            .all()
        )
        photo_by_id = {item.id: item for item in photo_items}
        ordered_photos = [photo_by_id[photo_id] for photo_id in photo_ids if photo_id in photo_by_id]
        if len(ordered_photos) == len(photo_ids):
            photo_summary = build_capture_photo_summary(ordered_photos)
    return FlightCaptureOut(
        id=item.id,
        user_id=item.user_id,
        property_id=item.property_id,
        mission_id=item.mission_id,
        name=item.name,
        source=item.source,
        status=item.status,
        photo_ids=photo_ids,
        photo_count=item.photo_count,
        field_ids=json.loads(item.field_ids_json),
        captured_from=item.captured_from,
        captured_to=item.captured_to,
        first_photo_id=photo_summary["first_photo_id"],
        last_photo_id=photo_summary["last_photo_id"],
        is_contiguous=photo_summary["is_contiguous"],
        notes=item.notes,
        processing_run_count=len(item.processing_runs),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _processing_artifact_out(item: ProcessingArtifact) -> ProcessingArtifactOut:
    return ProcessingArtifactOut(
        id=item.id,
        processing_run_id=item.processing_run_id,
        ingest_run_id=item.ingest_run_id,
        kind=item.kind,
        format=item.format,
        uri=item.uri,
        source_ref=item.source_ref,
        bytes=item.bytes,
        checksum=item.checksum,
        is_public=item.is_public,
        metadata=json.loads(item.metadata_json),
        provenance=json.loads(item.provenance_json),
        public_url=artifact_public_url(item),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _photo_asset_out(item: PhotoAsset) -> PhotoAssetOut:
    return PhotoAssetOut(
        id=item.id,
        photo_id=item.photo_id,
        ingest_run_id=item.ingest_run_id,
        kind=item.kind,
        path=item.path,
        mime=item.mime,
        bytes=item.bytes,
        width=item.width,
        height=item.height,
        checksum=item.checksum,
        source_ref=item.source_ref,
        provenance=json.loads(item.provenance_json),
        asset_url=f"/api/v1/assets/{item.path}",
    )


def _processing_run_out(item: ProcessingRun) -> ProcessingRunOut:
    provider_config = json.loads(item.provider_config_json)
    provider_config.setdefault("_provider_profile", processing_provider_profile(item.provider, allow_legacy=True))
    return ProcessingRunOut(
        id=item.id,
        capture_id=item.capture_id,
        provider=item.provider,
        status=item.status,
        external_job_id=item.external_job_id,
        requested_outputs=json.loads(item.requested_outputs_json),
        provider_config=provider_config,
        input_manifest=json.loads(item.input_manifest_json),
        error_detail=item.error_detail,
        started_at=item.started_at,
        finished_at=item.finished_at,
        last_synced_at=item.last_synced_at,
        artifact_count=len(item.artifacts),
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _stac_href(request: Request, path: str) -> str:
    return str(request.base_url).rstrip("/") + path


def _field_plot_lookup(db: Session, property_obj: Property, field_ids: list[int]) -> dict[int, FieldPlot]:
    if not field_ids:
        return {}
    items = (
        db.execute(
            select(FieldPlot).where(
                FieldPlot.property_id == property_obj.id,
                FieldPlot.id.in_(field_ids),
            )
        )
        .scalars()
        .all()
    )
    return {item.id: item for item in items}


def _capture_bbox_from_fields(field_lookup: dict[int, FieldPlot], field_ids: list[int]) -> list[float] | None:
    boxes: list[list[float]] = []
    for field_id in field_ids:
        item = field_lookup.get(field_id)
        if item is None:
            continue
        geometry = json.loads(item.geometry_json)
        boxes.append(geometry_bbox(geometry))
    if boxes:
        return union_bboxes(boxes)
    return None


def _capture_bbox_from_photos(db: Session, capture: FlightCapture) -> list[float] | None:
    photo_ids = json.loads(capture.photo_ids_json)
    if not photo_ids:
        return None
    photos = (
        db.execute(select(Photo).where(Photo.id.in_(photo_ids)))
        .scalars()
        .all()
    )
    if not photos:
        return None
    return [
        min(photo.lng for photo in photos),
        min(photo.lat for photo in photos),
        max(photo.lng for photo in photos),
        max(photo.lat for photo in photos),
    ]


def _stac_item_geometry(
    *,
    db: Session,
    capture: FlightCapture,
    ortho_artifact: ProcessingArtifact,
    field_lookup: dict[int, FieldPlot],
) -> tuple[dict, list[float]]:
    metadata = json.loads(ortho_artifact.metadata_json)
    geometry = metadata.get("geometry")
    bbox = metadata.get("bbox")
    if isinstance(geometry, dict):
        normalized_bbox = _normalize_bbox_values(bbox) or geometry_bbox(geometry)
        return geometry, normalized_bbox
    if isinstance(bbox, list) and len(bbox) == 4:
        normalized_bbox = [float(value) for value in bbox]
        return stac_bbox_to_geometry(normalized_bbox), normalized_bbox

    capture_bbox = _capture_bbox_from_fields(field_lookup, json.loads(capture.field_ids_json))
    if capture_bbox is None:
        capture_bbox = _capture_bbox_from_photos(db, capture)
    if capture_bbox is None:
        raise HTTPException(status_code=409, detail="Flight capture mangler geometri for STAC-eksport")
    return stac_bbox_to_geometry(capture_bbox), capture_bbox


def _stac_item_assets(request: Request, run: ProcessingRun) -> dict[str, StacAsset]:
    assets: dict[str, StacAsset] = {}
    for artifact in run.artifacts:
        asset_key = stac_asset_key(artifact)
        if asset_key is None:
            continue
        public_href = artifact_public_url(artifact)
        if public_href is None:
            continue
        asset_template = STAC_ITEM_ASSETS[asset_key]
        metadata = json.loads(artifact.metadata_json)
        asset_payload: dict = {
            "href": public_href,
            "type": asset_template["type"],
            "title": asset_template["title"],
            "description": asset_template["description"],
            "roles": list(asset_template["roles"]),
        }
        if asset_key == "ortho":
            for metadata_key in ("proj:code", "proj:shape", "proj:transform", "bands"):
                if metadata_key in metadata:
                    asset_payload[metadata_key] = metadata[metadata_key]
        assets[asset_key] = StacAsset.model_validate(asset_payload)

    assets["metadata"] = StacAsset(
        href=_stac_href(request, f"/api/v1/processing-runs/{run.id}"),
        type=STAC_ITEM_ASSETS["metadata"]["type"],
        title=STAC_ITEM_ASSETS["metadata"]["title"],
        description=STAC_ITEM_ASSETS["metadata"]["description"],
        roles=list(STAC_ITEM_ASSETS["metadata"]["roles"]),
    )
    return assets


def _stac_item_out(
    *,
    request: Request,
    db: Session,
    capture: FlightCapture,
    run: ProcessingRun,
    field_lookup: dict[int, FieldPlot],
) -> StacItemOut | None:
    ortho_artifact = next((artifact for artifact in run.artifacts if artifact.kind == "ortho"), None)
    if ortho_artifact is None:
        return None

    geometry, bbox = _stac_item_geometry(
        db=db,
        capture=capture,
        ortho_artifact=ortho_artifact,
        field_lookup=field_lookup,
    )
    collection_id = stac_collection_id(capture)
    item_id = stac_item_id(run)
    datetime_value, start_datetime, end_datetime = processing_run_temporal(capture, run)
    properties = {
        "datetime": datetime_value,
        "start_datetime": start_datetime,
        "end_datetime": end_datetime,
    }
    item_path = f"/api/v1/stac/collections/{collection_id}/items/{item_id}"
    return StacItemOut(
        type="Feature",
        stac_version=STAC_VERSION,
        stac_extensions=[STAC_PROJECTION_EXTENSION],
        id=item_id,
        collection=collection_id,
        geometry=geometry,
        bbox=bbox,
        properties=properties,
        links=[
            StacLink(rel="self", href=_stac_href(request, item_path), type="application/geo+json"),
            StacLink(
                rel="collection",
                href=_stac_href(request, f"/api/v1/stac/collections/{collection_id}"),
                type="application/json",
            ),
        ],
        assets=_stac_item_assets(request, run),
    )


def _stac_items_for_capture(
    request: Request,
    db: Session,
    property_obj: Property,
    capture: FlightCapture,
) -> list[StacItemOut]:
    field_lookup = _field_plot_lookup(db, property_obj, json.loads(capture.field_ids_json))
    items: list[StacItemOut] = []
    for run in sorted(capture.processing_runs, key=lambda item: (item.created_at, item.id)):
        item = _stac_item_out(request=request, db=db, capture=capture, run=run, field_lookup=field_lookup)
        if item is not None:
            items.append(item)
    return items


def _stac_collection_out(
    request: Request,
    capture: FlightCapture,
    items: list[StacItemOut],
) -> StacCollectionOut:
    if not items:
        raise HTTPException(status_code=404, detail="Flight capture har ingen STAC-klare items")

    bbox = union_bboxes([item.bbox for item in items])
    start_candidates = [item.properties.get("start_datetime") or item.properties.get("datetime") for item in items]
    end_candidates = [item.properties.get("end_datetime") or item.properties.get("datetime") for item in items]
    start_values = [value for value in start_candidates if value]
    end_values = [value for value in end_candidates if value]
    collection_id = stac_collection_id(capture)
    return StacCollectionOut(
        type="Collection",
        stac_version=STAC_VERSION,
        stac_extensions=[STAC_PROJECTION_EXTENSION],
        id=collection_id,
        title=stac_collection_title(capture),
        description=stac_collection_description(capture),
        license=STAC_COLLECTION_LICENSE,
        extent={
            "spatial": {"bbox": [bbox]},
            "temporal": {"interval": [[min(start_values) if start_values else None, max(end_values) if end_values else None]]},
        },
        links=[
            StacLink(
                rel="self",
                href=_stac_href(request, f"/api/v1/stac/collections/{collection_id}"),
                type="application/json",
            ),
            StacLink(
                rel="items",
                href=_stac_href(request, f"/api/v1/stac/collections/{collection_id}/items"),
                type="application/geo+json",
            ),
        ],
        item_assets={
            asset_key: StacAsset.model_validate(asset_payload)
            for asset_key, asset_payload in STAC_ITEM_ASSETS.items()
        },
    )


def _resolve_stac_capture(
    db: Session,
    property_obj: Property,
    collection_id: str,
) -> FlightCapture:
    if not collection_id.startswith("capture-"):
        raise HTTPException(status_code=404, detail="Fant ikke STAC-collection")
    try:
        capture_id = int(collection_id.removeprefix("capture-"))
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Fant ikke STAC-collection") from exc
    item = _resolve_flight_capture(db, property_obj=property_obj, capture_id=capture_id)
    if not any(artifact.kind == "ortho" for run in item.processing_runs for artifact in run.artifacts):
        raise HTTPException(status_code=404, detail="Flight capture har ingen STAC-klare items")
    return item


def _resolve_field_plots_for_mission(db: Session, property_obj: Property, field_ids: list[int]) -> list[FieldPlot]:
    normalized_ids: list[int] = []
    for raw_id in field_ids:
        field_id = int(raw_id)
        if field_id not in normalized_ids:
            normalized_ids.append(field_id)

    if not normalized_ids:
        raise HTTPException(status_code=400, detail="Oppdraget må knyttes til minst ett jord")

    field_items = (
        db.execute(
            select(FieldPlot)
            .where(FieldPlot.property_id == property_obj.id)
            .where(FieldPlot.id.in_(normalized_ids))
            .order_by(FieldPlot.id.asc())
        )
        .scalars()
        .all()
    )
    field_by_id = {item.id: item for item in field_items}
    missing_ids = [field_id for field_id in normalized_ids if field_id not in field_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Fant ikke valgte jorder for aktiv eiendom: {', '.join(str(item) for item in missing_ids)}",
        )

    return [field_by_id[field_id] for field_id in normalized_ids]


def _resolve_planning_units_for_mission(
    db: Session,
    property_obj: Property,
    planning_unit_ids: list[int],
) -> list[PlanningUnit]:
    normalized_ids: list[int] = []
    for raw_id in planning_unit_ids:
        unit_id = int(raw_id)
        if unit_id not in normalized_ids:
            normalized_ids.append(unit_id)

    if not normalized_ids:
        return []

    unit_items = (
        db.execute(
            select(PlanningUnit)
            .options(selectinload(PlanningUnit.source_field_plot))
            .where(PlanningUnit.property_id == property_obj.id)
            .where(PlanningUnit.status == "active")
            .where(PlanningUnit.id.in_(normalized_ids))
            .order_by(PlanningUnit.id.asc())
        )
        .scalars()
        .all()
    )
    unit_by_id = {item.id: item for item in unit_items}
    missing_ids = [unit_id for unit_id in normalized_ids if unit_id not in unit_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Fant ikke valgte planenheter for aktiv eiendom: {', '.join(str(item) for item in missing_ids)}",
        )
    return [unit_by_id[unit_id] for unit_id in normalized_ids]


def _mission_geometry_sources(
    *,
    fields: list[FieldPlot],
    planning_units: list[PlanningUnit],
) -> list[dict[str, object]]:
    if planning_units:
        return [planning_unit_payload_from_unit(item) for item in planning_units]
    return [planning_unit_payload_from_field(item) for item in fields]


def _build_flight_mission_preview_payload(
    db: Session,
    *,
    property_obj: Property,
    payload: FlightMissionCreate | FlightMissionPatch,
    existing: FlightMission | None = None,
) -> dict[str, object]:
    if existing is None:
        field_ids = list(getattr(payload, "field_ids", []))
        planning_unit_ids = list(getattr(payload, "planning_unit_ids", []))
        drone_profile_id = getattr(payload, "drone_profile_id", None)
        mission_name = payload.name
        parameters = payload.parameters.model_dump()
    else:
        field_ids = payload.field_ids if payload.field_ids is not None else json.loads(existing.field_ids_json)
        planning_unit_ids = (
            payload.planning_unit_ids
            if payload.planning_unit_ids is not None
            else json.loads(existing.planning_unit_ids_json)
        )
        drone_profile_id = (
            payload.drone_profile_id if "drone_profile_id" in payload.model_fields_set else existing.drone_profile_id
        )
        mission_name = payload.name if "name" in payload.model_fields_set else existing.name
        parameters = json.loads(existing.parameters_json)
        if payload.parameters is not None:
            parameters = {
                **parameters,
                **payload.parameters.model_dump(exclude_unset=True),
            }

    field_items = _resolve_field_plots_for_mission(db, property_obj, field_ids) if field_ids else []
    planning_unit_items = (
        _resolve_planning_units_for_mission(db, property_obj, planning_unit_ids) if planning_unit_ids else []
    )
    drone_profile = get_drone_profile(drone_profile_id)
    if drone_profile_id and drone_profile is None:
        raise HTTPException(status_code=400, detail="Ukjent droneprofil")

    return build_flight_mission_payload(
        property_obj=property_obj,
        fields=_mission_geometry_sources(fields=field_items, planning_units=planning_unit_items),
        name=mission_name,
        parameters=parameters,
        planning_unit_ids=planning_unit_ids,
        drone_profile=drone_profile,
    )


def _resolve_flight_capture_photos(
    db: Session,
    *,
    user_id: int,
    property_obj: Property,
    photo_ids: list[str],
) -> list[Photo]:
    normalized_ids: list[str] = []
    for raw_id in photo_ids:
        photo_id = str(raw_id).strip()
        if photo_id and photo_id not in normalized_ids:
            normalized_ids.append(photo_id)

    if not normalized_ids:
        raise HTTPException(status_code=400, detail="Capture må inneholde minst ett bilde")

    photo_items = (
        db.execute(
            select(Photo)
            .where(Photo.user_id == user_id)
            .where(Photo.id.in_(normalized_ids))
            .order_by(Photo.captured_at.asc(), Photo.id.asc())
        )
        .scalars()
        .all()
    )
    photo_by_id = {item.id: item for item in photo_items}
    missing_ids = [photo_id for photo_id in normalized_ids if photo_id not in photo_by_id]
    if missing_ids:
        raise HTTPException(status_code=400, detail=f"Fant ikke valgte bilder: {missing_ids}")

    ordered = [photo_by_id[photo_id] for photo_id in normalized_ids]
    wrong_property = [photo.id for photo in ordered if photo.property_id != property_obj.id]
    if wrong_property:
        raise HTTPException(
            status_code=400,
            detail=f"Alle bilder i en capture må tilhøre aktiv eiendom: {wrong_property}",
        )
    return ordered


def _resolve_flight_capture(
    db: Session,
    *,
    property_obj: Property,
    capture_id: int,
) -> FlightCapture:
    item = (
        db.execute(
            select(FlightCapture)
            .options(selectinload(FlightCapture.processing_runs))
            .where(FlightCapture.id == capture_id, FlightCapture.property_id == property_obj.id)
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke flight capture")
    return item


def _planning_unit_latest_mission_lookup(missions: list[FlightMission]) -> dict[int, FlightMission]:
    lookup: dict[int, FlightMission] = {}
    for mission in missions:
        for planning_unit_id in json.loads(mission.planning_unit_ids_json):
            unit_id = int(planning_unit_id)
            current = lookup.get(unit_id)
            if current is None or (mission.updated_at, mission.id) > (current.updated_at, current.id):
                lookup[unit_id] = mission
    return lookup


def _planning_unit_list_response(
    db: Session,
    *,
    property_obj: Property,
    units: list[PlanningUnit],
) -> PlanningUnitListResponse:
    field_lookup = {
        item.id: item
        for item in db.execute(
            select(FieldPlot).where(
                FieldPlot.property_id == property_obj.id,
                FieldPlot.id.in_([unit.source_field_plot_id for unit in units] or [-1]),
            )
        )
        .scalars()
        .all()
    }
    missions = (
        db.execute(
            select(FlightMission)
            .where(FlightMission.property_id == property_obj.id)
            .order_by(FlightMission.updated_at.desc(), FlightMission.id.desc())
        )
        .scalars()
        .all()
    )
    latest_mission_lookup = _planning_unit_latest_mission_lookup(missions)
    items = []
    for unit in units:
        source_field = field_lookup.get(unit.source_field_plot_id)
        latest_mission = latest_mission_lookup.get(unit.id)
        items.append(
            _planning_unit_out(
                unit,
                source_field_name=planning_unit_field_name(source_field) if source_field else f"Jord {unit.source_field_plot_id}",
                source_field_source=source_field.source if source_field else "manual",
                source_field_status=source_field.status if source_field else "draft",
                source_field_provenance=field_source_provenance(source_field),
                latest_mission_id=latest_mission.id if latest_mission else None,
                latest_mission_name=(latest_mission.name or f"Oppdrag {latest_mission.id}").strip() if latest_mission else None,
                latest_duration_status=latest_mission.duration_status if latest_mission else None,
                latest_estimated_duration_s=latest_mission.estimated_duration_s if latest_mission else None,
            )
        )
    return PlanningUnitListResponse(property_id=property_obj.id, count=len(items), units=items)


@router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service": settings.app_name,
        "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
    }


@router.get("/orthophotos/{overlay_id}/color-sample", response_model=OrthophotoColorSampleResponse)
def get_orthophoto_color_sample(
    overlay_id: str,
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    sample_size_px: int = Query(21, ge=3, le=101),
    allow_preview: bool = Query(False),
    _user: User = Depends(_request_owner_user),
) -> dict:
    try:
        return sample_orthophoto_color(
            overlay_id,
            lat=lat,
            lng=lng,
            sample_size_px=sample_size_px,
            allow_preview=allow_preview,
        )
    except OrthophotoNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OrthophotoPointOutsideBounds as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OrthophotoNoData as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except OrthophotoSourceUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OrthophotoSamplingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/weather/season")
def get_weather_season(
    response: Response,
    start: date_type = Query(...),
    end: date_type = Query(...),
    property_id: int | None = Query(None, ge=1),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> dict:
    from ..services.weather_season import season_context

    property_obj = _require_active_property(db, user.id, property_id)
    if end > datetime.now(timezone.utc).date():
        raise HTTPException(status_code=422, detail="Historisk vær kan ikke hentes for framtidige datoer")
    try:
        # No reviewed Frost station/series or client ID exists for this pilot.
        # Keep the gate closed rather than return synthetic or estimated weather.
        result = season_context(start, end, reason="source_pending_review")
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    response.headers["Cache-Control"] = "no-store"
    return {"property_id": property_obj.id, **result}


@router.get("/logs", response_model=BackendLogsResponse)
def get_logs(
    limit: int = Query(default=200, ge=1, le=1000),
    level: str | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> BackendLogsResponse:
    _require_pilot_admin_identity(db, user)
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
def get_admin_session_status(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AdminSessionStatusResponse:
    if admin_access_is_open():
        _pilot_owner_for_login(db)
        if request.cookies.get(settings.admin_session_cookie_name):
            clear_admin_session(response)
        return AdminSessionStatusResponse(
            configured=True,
            open_access=True,
            authenticated=True,
            expires_at=None,
        )

    session = get_admin_session(request)
    if session is not None:
        try:
            _owner_user_for_session(db, session)
        except HTTPException:
            session = None
    if request.cookies.get(settings.admin_session_cookie_name) and session is None:
        clear_admin_session(response)

    return AdminSessionStatusResponse(
        configured=admin_access_is_configured(),
        open_access=False,
        authenticated=session is not None,
        expires_at=session.expires_at if session else None,
    )


@router.post("/admin/login", response_model=AdminSessionStatusResponse)
def login_admin(
    payload: AdminLoginRequest,
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
) -> AdminSessionStatusResponse:
    if admin_access_is_open():
        _pilot_owner_for_login(db)
        clear_admin_session(response)
        return AdminSessionStatusResponse(
            configured=True,
            open_access=True,
            authenticated=True,
            expires_at=None,
        )
    if not admin_access_code_is_configured():
        raise HTTPException(status_code=503, detail="Admin-innlogging er ikke konfigurert i backend")

    enforce_login_rate_limit(request)
    if not verify_admin_access_code(payload.code):
        register_failed_login(request)
        raise HTTPException(status_code=401, detail="Ugyldig admin-kode")

    reset_login_attempts(request)
    user = _pilot_owner_for_login(db)
    session = issue_admin_session(response, request, user_id=user.id)
    return AdminSessionStatusResponse(
        configured=True,
        open_access=False,
        authenticated=True,
        expires_at=session.expires_at,
    )


@router.post("/admin/logout", response_model=AdminSessionStatusResponse)
def logout_admin(response: Response) -> AdminSessionStatusResponse:
    clear_admin_session(response)
    open_access = admin_access_is_open()
    return AdminSessionStatusResponse(
        configured=admin_access_is_configured(),
        open_access=open_access,
        authenticated=open_access,
        expires_at=None,
    )


@router.get("/profile/current", response_model=ProfileOut)
def get_profile_current(
    response: Response,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
    response.headers["Cache-Control"] = "no-store"
    return _profile_out(db, user, include_private_contact=True)


@router.patch("/profile/current", response_model=ProfileOut)
def patch_profile_current(
    payload: ProfilePatchRequest = Body(default_factory=ProfilePatchRequest),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProfileOut:
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
                    farm_id=_active_writable_farm_id_for_user(
                        db,
                        user.id,
                        farm_id=property_obj.farm_id if property_obj is not None else None,
                    ),
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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> TimelineResponse:
    user_id = _session_user_id(user, user_id)

    dates = timeline_dates(db, user_id=user_id)
    return TimelineResponse(user_id=user_id, dates=[TimelineDateEntry(**item) for item in dates])


@router.get("/fields", response_model=FieldPlotListResponse)
def list_field_plots(
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldPlotListResponse:
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


@router.get("/fields/{field_id}/history", response_model=FieldHistoryOut)
def get_field_history(
    field_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldHistoryOut:
    property_obj = _require_current_property(db, user.id)
    field = (
        db.execute(select(FieldPlot).where(FieldPlot.id == field_id, FieldPlot.property_id == property_obj.id))
        .scalars()
        .first()
    )
    if field is None:
        raise HTTPException(status_code=404, detail="Fant ikke felt")

    field_missions, field_captures, processing_runs = _field_history_records(
        db,
        property_id=property_obj.id,
        field_id=field.id,
    )
    delivery_count = sum(1 for run in processing_runs if run.status == "completed" and len(run.artifacts) > 0)

    return FieldHistoryOut(
        field=_field_plot_out(field),
        mission_count=len(field_missions),
        capture_count=len(field_captures),
        processing_run_count=len(processing_runs),
        delivery_count=delivery_count,
        entries=_field_history_entries(field=field, missions=field_missions, captures=field_captures),
    )


@router.get("/fields/{field_id}/report", response_model=FieldReportOut)
def get_field_report(
    field_id: int,
    response: Response,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldReportOut:
    report = _build_field_report(db, user_id=user.id, field_id=field_id)
    response.headers["Cache-Control"] = "no-store"
    return report


@router.get("/fields/{field_id}/report.html", response_class=HTMLResponse)
def get_field_report_html(
    field_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    report = _build_field_report(db, user_id=user.id, field_id=field_id)
    response = HTMLResponse(render_field_report_html(report))
    response.headers["Cache-Control"] = "no-store"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@router.post("/fields", response_model=FieldPlotOut, status_code=status.HTTP_201_CREATED)
def create_field_plot(
    payload: FieldPlotCreate = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldPlotOut:
    property_obj = _require_active_property_for_capability(
        db,
        user_id=user.id,
        property_id=payload.property_id,
        capability="field.write",
    )
    geometry_json, area_m2 = _field_geometry_payload(payload.geometry)

    item = FieldPlot(
        property_id=property_obj.id,
        name=_normalize_field_name(payload.name),
        source=payload.source,
        status=payload.status,
        geometry_json=geometry_json,
        area_m2=area_m2,
        source_provenance_json=json.dumps(normalize_source_provenance(payload.source_provenance), ensure_ascii=False),
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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldPlotOut:
    item = _require_field_plot_for_capability(
        db,
        user_id=user.id,
        field_id=field_id,
        capability="field.write",
    )

    if "name" in payload.model_fields_set:
        item.name = _normalize_field_name(payload.name)
    if payload.source is not None:
        item.source = payload.source
    if payload.status is not None:
        item.status = payload.status
    if "source_provenance" in payload.model_fields_set:
        item.source_provenance_json = json.dumps(normalize_source_provenance(payload.source_provenance), ensure_ascii=False)
    if payload.geometry is not None:
        geometry_json, area_m2 = _field_geometry_payload(payload.geometry)
        item.geometry_json = geometry_json
        item.area_m2 = area_m2
        active_units = (
            db.execute(
                select(PlanningUnit).where(
                    PlanningUnit.property_id == item.property_id,
                    PlanningUnit.source_field_plot_id == item.id,
                    PlanningUnit.status == "active",
                )
            )
            .scalars()
            .all()
        )
        for unit in active_units:
            if unit.parent_unit_id is not None:
                continue
            unit.geometry_json = geometry_json
            unit.area_m2 = area_m2

    db.commit()
    db.refresh(item)
    return _field_plot_out(item)


@router.delete("/fields/{field_id}", response_model=FieldPlotDeleteResponse)
def delete_field_plot(
    field_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldPlotDeleteResponse:
    item = _require_user_field_plot(db, user_id=user.id, field_id=field_id)

    db.execute(
        delete(PlanningUnit).where(
            PlanningUnit.property_id == item.property_id,
            PlanningUnit.source_field_plot_id == field_id,
        )
    )
    db.delete(item)
    db.commit()
    return FieldPlotDeleteResponse(status="deleted", field_id=field_id)


@router.get("/fields/export.geojson")
def export_field_plots_geojson(
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    property_obj = _require_current_property(db, user.id)
    query = (
        select(FieldPlot)
        .where(FieldPlot.property_id == property_obj.id)
        .order_by(FieldPlot.updated_at.desc(), FieldPlot.id.desc())
    )
    normalized_status = status_filter.strip().lower() if status_filter else None
    if normalized_status is not None:
        if normalized_status not in {"draft", "confirmed"}:
            raise HTTPException(status_code=400, detail="Ugyldig feltstatus")
        query = query.where(FieldPlot.status == normalized_status)

    items = db.execute(query).scalars().all()
    features = [
        {
            "type": "Feature",
            "properties": {
                "field_id": item.id,
                "property_id": item.property_id,
                "name": item.name,
                "source": item.source,
                "status": item.status,
                "source_provenance": field_source_provenance(item),
                "area_m2": round(item.area_m2, 2) if item.area_m2 is not None else None,
                "area_ha": round((item.area_m2 or 0) / 10_000, 4) if item.area_m2 is not None else None,
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat(),
            },
            "geometry": json.loads(item.geometry_json),
        }
        for item in items
    ]
    return _geojson_response(
        resource="field_plots",
        export_path="/api/v1/fields/export.geojson",
        import_paths=["/api/v1/fields", "/api/v1/fields/{field_id}"],
        features=features,
        extra={
            "property": {
                "id": property_obj.id,
                "komm": property_obj.komm,
                "gnr": property_obj.gnr,
                "bnr": property_obj.bnr,
                "fnr": property_obj.fnr,
                "label": property_obj.label,
            },
        },
    )


@router.get("/drone-profiles", response_model=DroneProfileListResponse)
def list_planning_drone_profiles(
    _user: User = Depends(_request_owner_user),
) -> DroneProfileListResponse:
    profiles = [DroneProfileOut(**item) for item in list_drone_profiles()]
    return DroneProfileListResponse(count=len(profiles), profiles=profiles)


@router.post("/planning/properties/{property_id}/sync", response_model=PlanningUnitSyncResponse)
async def sync_property_planning_units(
    property_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PlanningUnitSyncResponse:
    property_obj = _require_active_property(db, user.id, property_id)

    try:
        candidates = await list_field_candidates_for_property(property_obj)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge teigoppslag feilet under planleggingssynk",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente jorder fra Geonorge: {exc}") from exc
    try:
        sync_fields_from_candidates(db, property_obj=property_obj, candidates=candidates, status="draft")
        units, created_count = sync_planning_units(db, property_obj=property_obj)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Jordene eller planområdene ble nettopp oppdatert. Prøv synkroniseringen på nytt.",
        ) from exc
    response = _planning_unit_list_response(db, property_obj=property_obj, units=units)
    return PlanningUnitSyncResponse(property_id=response.property_id, count=response.count, units=response.units, created_count=created_count)


@router.get("/planning/properties/{property_id}/units", response_model=PlanningUnitListResponse)
def list_property_planning_units(
    property_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PlanningUnitListResponse:
    property_obj = _require_active_property(db, user.id, property_id)

    units = (
        db.execute(
            select(PlanningUnit)
            .where(PlanningUnit.property_id == property_obj.id, PlanningUnit.status == "active")
            .order_by(PlanningUnit.updated_at.desc(), PlanningUnit.id.desc())
        )
        .scalars()
        .all()
    )
    return _planning_unit_list_response(db, property_obj=property_obj, units=units)


@router.get("/scouting/tasks", response_model=ScoutingTaskListResponse)
def list_scouting_tasks(
    property_id: int | None = Query(default=None),
    field_id: int | None = Query(default=None),
    planning_unit_id: int | None = Query(default=None),
    status_filter: ScoutingTaskStatus | None = Query(default=None, alias="status"),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ScoutingTaskListResponse:
    property_ids = _active_property_ids(db, user.id)
    selected_property_id: int | None = None
    selected_field: FieldPlot | None = None
    selected_unit: PlanningUnit | None = None

    query = select(ScoutingTask).where(ScoutingTask.property_id.in_(property_ids or [-1]))
    if property_id is not None:
        property_obj = _require_active_property(db, user.id, property_id)
        selected_property_id = property_obj.id
        query = query.where(ScoutingTask.property_id == property_obj.id)
    if field_id is not None:
        selected_field = _require_user_field_plot(db, user_id=user.id, field_id=field_id)
        if selected_property_id is not None and selected_field.property_id != selected_property_id:
            raise HTTPException(status_code=400, detail="Feltet tilhører ikke valgt eiendom")
        selected_property_id = selected_field.property_id
        query = query.where(ScoutingTask.field_plot_id == selected_field.id)
    if planning_unit_id is not None:
        selected_unit = _require_user_planning_unit(db, user_id=user.id, unit_id=planning_unit_id)
        if selected_property_id is not None and selected_unit.property_id != selected_property_id:
            raise HTTPException(status_code=400, detail="Planenheten tilhører ikke valgt eiendom")
        if selected_field is not None and selected_unit.source_field_plot_id != selected_field.id:
            raise HTTPException(status_code=400, detail="Planenheten tilhører ikke valgt felt")
        selected_property_id = selected_unit.property_id
        query = query.where(ScoutingTask.planning_unit_id == selected_unit.id)
    if status_filter is not None:
        query = query.where(ScoutingTask.status == status_filter)

    tasks = (
        db.execute(query.order_by(ScoutingTask.updated_at.desc(), ScoutingTask.id.desc()))
        .scalars()
        .all()
    )
    return ScoutingTaskListResponse(
        property_id=selected_property_id,
        count=len(tasks),
        tasks=[_scouting_task_out(item) for item in tasks],
    )


@router.post("/scouting/tasks", response_model=ScoutingTaskOut, status_code=status.HTTP_201_CREATED)
def create_scouting_task(
    payload: ScoutingTaskCreate = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ScoutingTaskOut:
    property_obj, field, planning_unit = _resolve_scouting_scope(
        db,
        user_id=user.id,
        field_id=payload.field_id,
        property_id=payload.property_id,
        planning_unit_id=payload.planning_unit_id,
    )
    lat, lng = _validate_scouting_position(payload.position)
    photo_ids = _resolve_scouting_photo_ids(
        db,
        user_id=user.id,
        property_obj=property_obj,
        photo_ids=payload.photo_ids,
    )
    observed_at: datetime | None = None
    observed_at_original_offset: str | None = None
    if payload.observed_at is not None:
        observed_at, observed_at_original_offset = _normalize_scouting_observed_at(payload.observed_at)

    item = ScoutingTask(
        property_id=property_obj.id,
        field_plot_id=field.id,
        planning_unit_id=planning_unit.id if planning_unit else None,
        title=payload.title,
        notes=payload.notes,
        status=payload.status,
        priority=payload.priority,
        observed_at=observed_at,
        observed_at_original_offset=observed_at_original_offset,
        lat=lat,
        lng=lng,
        photo_ids_json=json.dumps(photo_ids, ensure_ascii=False),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _scouting_task_out(item)


@router.patch("/scouting/tasks/{task_id}", response_model=ScoutingTaskOut)
def patch_scouting_task(
    task_id: int,
    payload: ScoutingTaskPatch = Body(default_factory=ScoutingTaskPatch),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ScoutingTaskOut:
    item = _require_user_scouting_task(db, user_id=user.id, task_id=task_id)

    if payload.title is not None:
        item.title = payload.title
    if "notes" in payload.model_fields_set:
        item.notes = payload.notes
    if payload.status is not None:
        item.status = payload.status
    if payload.priority is not None:
        item.priority = payload.priority
    if "observed_at" in payload.model_fields_set:
        if payload.observed_at is None:
            item.observed_at = None
            item.observed_at_original_offset = None
        else:
            item.observed_at, item.observed_at_original_offset = _normalize_scouting_observed_at(
                payload.observed_at
            )
    if payload.position is not None:
        lat, lng = _validate_scouting_position(payload.position)
        item.lat = lat
        item.lng = lng
    if payload.photo_ids is not None:
        property_obj = _require_active_property(db, user.id, item.property_id)
        photo_ids = _resolve_scouting_photo_ids(
            db,
            user_id=user.id,
            property_obj=property_obj,
            photo_ids=payload.photo_ids,
        )
        item.photo_ids_json = json.dumps(photo_ids, ensure_ascii=False)

    db.commit()
    db.refresh(item)
    return _scouting_task_out(item)


@router.post("/planning/units/{unit_id}/split", response_model=PlanningUnitSplitOut)
def split_property_planning_unit(
    unit_id: int,
    payload: PlanningUnitSplitIn = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PlanningUnitSplitOut:
    unit = _require_user_planning_unit(db, user_id=user.id, unit_id=unit_id)
    property_obj = _require_active_property(db, user.id, unit.property_id)

    try:
        split_parts = split_planning_unit(unit, line_coordinates=payload.line.coordinates)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    unit.status = "archived"
    source_field = (
        db.execute(
            select(FieldPlot).where(
                FieldPlot.id == unit.source_field_plot_id,
                FieldPlot.property_id == property_obj.id,
            )
        )
        .scalars()
        .first()
    )
    created_units: list[PlanningUnit] = []
    for part in split_parts:
        item = PlanningUnit(
            property_id=property_obj.id,
            source_field_plot_id=unit.source_field_plot_id,
            parent_unit_id=unit.id,
            name=part["name"],
            status="active",
            geometry_json=json.dumps(part["geometry"], ensure_ascii=False),
            area_m2=part["area_m2"],
        )
        db.add(item)
        created_units.append(item)

    db.commit()
    for item in created_units:
        db.refresh(item)
    db.refresh(unit)
    source_field_name = planning_unit_field_name(source_field) if source_field else f"Jord {unit.source_field_plot_id}"
    source_field_status = source_field.status if source_field else "draft"
    return PlanningUnitSplitOut(
        archived_unit=_planning_unit_out(
            unit,
            source_field_name=source_field_name,
            source_field_source=source_field.source if source_field else "manual",
            source_field_status=source_field_status,
            source_field_provenance=field_source_provenance(source_field),
        ),
        created_units=[
            _planning_unit_out(
                item,
                source_field_name=source_field_name,
                source_field_source=source_field.source if source_field else "manual",
                source_field_status=source_field_status,
                source_field_provenance=field_source_provenance(source_field),
            )
            for item in created_units
        ],
    )


async def _lookup_operating_area_candidates(payload: OperatingAreaPointIn) -> list[dict[str, Any]]:
    try:
        candidates = await lookup_field_candidates_by_point_any(
            lat=payload.lat,
            lng=payload.lng,
            radius_m=payload.radius_m,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Geonorge punktoppslag feilet for driftsareal")
        raise HTTPException(
            status_code=502,
            detail="Eiendomsoppslaget er midlertidig utilgjengelig. Prøv igjen.",
        ) from exc
    if not candidates:
        raise HTTPException(status_code=404, detail="Fant ingen teig på dette punktet")
    return candidates


@router.post("/operating-area-previews", response_model=OperatingAreaPreviewOut)
async def preview_operating_area(
    payload: OperatingAreaPointIn = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> OperatingAreaPreviewOut:
    candidates = await _lookup_operating_area_candidates(payload)
    items = []
    for candidate in candidates:
        try:
            items.append(operating_area_candidate_payload(db, user_id=user.id, candidate=candidate))
        except (KeyError, TypeError, ValueError) as exc:
            logger.warning("Geonorge returnerte ugyldig driftsarealkandidat", extra={"error": str(exc)})
    if not items:
        raise HTTPException(
            status_code=502,
            detail="Eiendomsoppslaget returnerte ufullstendige data. Prøv et annet punkt.",
        )
    return OperatingAreaPreviewOut(
        count=len(items),
        candidates=items,
        owner_information_available=False,
        owner_information_message=(
            "Eiernavn er ikke tilgjengelig i denne versjonen. "
            "Matrikkelnummer og teigdata kan fortsatt brukes."
        ),
    )


@router.put("/operating-areas/{candidate_id}", response_model=OperatingAreaConfirmOut)
async def confirm_operating_area(
    candidate_id: str,
    payload: OperatingAreaConfirmIn = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> OperatingAreaConfirmOut:
    if len(candidate_id) != 64 or any(char not in "0123456789abcdef" for char in candidate_id):
        raise HTTPException(status_code=409, detail="Teigvalget er ikke lenger gyldig. Trykk i kartet på nytt.")
    candidates = await _lookup_operating_area_candidates(payload)
    selected: dict[str, Any] | None = None
    for candidate in candidates:
        try:
            if operating_area_candidate_id(candidate) == candidate_id:
                selected = candidate
                break
        except (KeyError, TypeError, ValueError):
            continue
    if selected is None:
        raise HTTPException(status_code=409, detail="Teigen er endret eller borte. Trykk i kartet på nytt.")

    property_ref = selected.get("property_ref")
    geometry = selected.get("geometry")
    if not isinstance(property_ref, dict) or not isinstance(geometry, dict):
        raise HTTPException(status_code=502, detail="Eiendomsoppslaget returnerte ufullstendige data.")
    try:
        property_obj, property_created = _ensure_user_property(
            db,
            user_id=user.id,
            komm=str(property_ref["komm"]),
            gnr=int(property_ref["gnr"]),
            bnr=int(property_ref["bnr"]),
            fnr=int(property_ref.get("fnr") or 0),
            label=str(property_ref.get("label") or "").strip() or None,
        )
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="Eiendommen ble nettopp lagt til. Prøv bekreftelsen på nytt."
        ) from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(status_code=502, detail="Eiendomsoppslaget mangler gyldig matrikkeldata.") from exc

    source_key = operating_area_source_key(selected)
    selected = {**selected, "candidate_id": candidate_id, "source_key": source_key}
    try:
        field = find_field_for_candidate(
            db,
            property_obj=property_obj,
            candidate=selected,
            source_key=source_key,
        )
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="Eiendomsoppslaget returnerte ugyldig geometri.") from exc
    field_created = field is None
    if field is None:
        try:
            field = create_field_from_candidate(
                db, property_obj=property_obj, candidate=selected, status="draft"
            )
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=409, detail="Teigen ble nettopp lagt til. Prøv bekreftelsen på nytt."
            ) from exc
    refresh_imported_field_from_candidate(field, selected)

    active_units = list(
        db.execute(
            select(PlanningUnit)
            .where(
                PlanningUnit.property_id == property_obj.id,
                PlanningUnit.source_field_plot_id == field.id,
                PlanningUnit.status == "active",
            )
            .order_by(PlanningUnit.id)
        ).scalars()
    )
    planning_units_created = 0
    if not active_units:
        try:
            unit, created = ensure_active_planning_unit_for_field(
                db, property_obj=property_obj, field=field
            )
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=409, detail="Planområdet ble nettopp oppdatert. Last kartet på nytt."
            ) from exc
        active_units = [unit]
        planning_units_created = int(created)
    elif len(active_units) == 1:
        refresh_root_planning_unit_from_field(active_units[0], field)

    if property_obj.operating_relation != payload.operating_relation:
        property_obj.operating_relation = payload.operating_relation
        property_obj.operating_relation_source = "map_confirmation"
        property_obj.operating_relation_confirmed_at = datetime.utcnow()
    elif property_obj.operating_relation_source is None:
        property_obj.operating_relation_source = "map_confirmation"
        property_obj.operating_relation_confirmed_at = datetime.utcnow()

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Teigen ble nettopp lagt til. Last kartet på nytt.") from exc
    db.refresh(property_obj)
    db.refresh(field)
    for unit in active_units:
        db.refresh(unit)

    provenance = field_source_provenance(field)
    return OperatingAreaConfirmOut(
        property=PropertyOut.model_validate(property_obj),
        field=_field_plot_out(field),
        planning_units=[
            _planning_unit_out(
                unit,
                source_field_name=planning_unit_field_name(field),
                source_field_source=field.source,
                source_field_status=field.status,
                source_field_provenance=provenance,
            )
            for unit in active_units
        ],
        property_created=property_created,
        field_created=field_created,
        planning_units_created=planning_units_created,
    )


def _resolve_planning_candidate(
    db: Session,
    *,
    property_obj: Property,
    candidate: dict[str, Any],
) -> tuple[FieldPlot, PlanningUnit, bool, bool]:
    try:
        candidate, source_key = candidate_with_property_identity(candidate, property_obj)
        candidate = {**candidate, "source_key": source_key}
        field = find_field_for_candidate(
            db, property_obj=property_obj, candidate=candidate, source_key=source_key
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Kandidaten mangler gyldig kildeidentitet") from exc

    imported_field = field is None
    try:
        if field is None:
            field = create_field_from_candidate(
                db, property_obj=property_obj, candidate=candidate, status="draft"
            )
        refresh_imported_field_from_candidate(field, candidate)
        unit, created_unit = ensure_active_planning_unit_for_field(
            db, property_obj=property_obj, field=field
        )
        if not created_unit:
            refresh_root_planning_unit_from_field(unit, field)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Teigen eller planområdet ble nettopp oppdatert. Prøv oppslaget på nytt.",
        ) from exc
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Kandidaten mangler gyldig geometri") from exc

    db.refresh(unit)
    db.refresh(field)
    return field, unit, imported_field, created_unit


@router.post("/planning/resolve-point", response_model=PlanningPointResolveOut)
async def resolve_owned_planning_point(
    payload: PlanningPointResolveIn = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PlanningPointResolveOut:
    try:
        candidates = await lookup_field_candidates_by_point_any(
            lat=payload.lat,
            lng=payload.lng,
            radius_m=payload.radius_m,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge punktoppslag feilet under generelt planleggingsoppslag",
            extra={"error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke finne teig fra punkt: {exc}") from exc

    if not candidates:
        raise HTTPException(status_code=404, detail="Fant ingen teig på dette punktet")

    candidate = candidates[0]
    property_ref = candidate.get("property_ref")
    if not isinstance(property_ref, dict):
        raise HTTPException(status_code=400, detail="Kandidaten mangler matrikkeldata")
    komm = str(property_ref.get("komm") or "").strip()
    gnr = property_ref.get("gnr")
    bnr = property_ref.get("bnr")
    fnr = property_ref.get("fnr") or 0
    if not komm or gnr is None or bnr is None:
        raise HTTPException(status_code=400, detail="Kandidaten mangler gyldig gårds- og bruksnummer")

    property_obj, property_created = _ensure_user_property(
        db,
        user_id=user.id,
        komm=komm,
        gnr=int(gnr),
        bnr=int(bnr),
        fnr=int(fnr),
        label=str(property_ref.get("label") or "").strip() or None,
    )
    geometry = candidate.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=400, detail="Kandidaten mangler gyldig geometri")

    field, unit, imported_field, created_unit = _resolve_planning_candidate(
        db, property_obj=property_obj, candidate=candidate
    )

    return PlanningPointResolveOut(
        property_id=property_obj.id,
        property_label=property_obj.label,
        unit=_planning_unit_out(
            unit,
            source_field_name=planning_unit_field_name(field),
            source_field_source=field.source,
            source_field_status=field.status,
            source_field_provenance=field_source_provenance(field),
        ),
        imported_field=imported_field,
        created_unit=created_unit,
        property_created=property_created,
        candidate_name=str(candidate.get("name") or "").strip() or None,
        matrikkelnummer=str(candidate.get("matrikkelnummer") or "").strip() or None,
        distance_m=int(candidate["distance_m"]) if candidate.get("distance_m") is not None else None,
    )


@router.post("/planning/properties/{property_id}/resolve-point", response_model=PlanningPointResolveOut)
async def resolve_property_planning_point(
    property_id: int,
    payload: PlanningPointResolveIn = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PlanningPointResolveOut:
    property_obj = _require_active_property(db, user.id, property_id)

    try:
        candidates = await lookup_field_candidates_by_point(
            property_obj,
            lat=payload.lat,
            lng=payload.lng,
            radius_m=payload.radius_m,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge punktoppslag feilet under planleggingsoppslag",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke finne jord fra punkt: {exc}") from exc

    if not candidates:
        raise HTTPException(status_code=404, detail="Fant ingen jord på dette punktet for aktiv eiendom")

    candidate = candidates[0]
    geometry = candidate.get("geometry")
    if not isinstance(geometry, dict):
        raise HTTPException(status_code=400, detail="Kandidaten mangler gyldig geometri")

    field, unit, imported_field, created_unit = _resolve_planning_candidate(
        db, property_obj=property_obj, candidate=candidate
    )

    return PlanningPointResolveOut(
        property_id=property_obj.id,
        property_label=property_obj.label,
        unit=_planning_unit_out(
            unit,
            source_field_name=planning_unit_field_name(field),
            source_field_source=field.source,
            source_field_status=field.status,
            source_field_provenance=field_source_provenance(field),
        ),
        imported_field=imported_field,
        created_unit=created_unit,
        property_created=False,
        candidate_name=str(candidate.get("name") or "").strip() or None,
        matrikkelnummer=str(candidate.get("matrikkelnummer") or "").strip() or None,
        distance_m=int(candidate["distance_m"]) if candidate.get("distance_m") is not None else None,
    )


@router.get("/flight-missions", response_model=FlightMissionListResponse)
def list_flight_missions(
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightMissionListResponse:
    property_obj = _require_active_property(db, user.id, property_id)
    missions = (
        db.execute(
            select(FlightMission)
            .where(FlightMission.property_id == property_obj.id)
            .order_by(FlightMission.updated_at.desc(), FlightMission.id.desc())
        )
        .scalars()
        .all()
    )
    return FlightMissionListResponse(
        property_id=property_obj.id,
        count=len(missions),
        missions=[_flight_mission_out(item) for item in missions],
    )


@router.post("/flight-missions/preview", response_model=FlightMissionPreviewOut)
def preview_flight_mission(
    payload: FlightMissionCreate = Body(...),
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightMissionPreviewOut:
    property_obj = _require_active_property(db, user.id, payload.property_id if payload.property_id is not None else property_id)
    mission_payload = _build_flight_mission_preview_payload(db, property_obj=property_obj, payload=payload)
    return _flight_mission_preview_out(mission_payload)


@router.post("/flight-missions", response_model=FlightMissionOut, status_code=status.HTTP_201_CREATED)
def create_flight_mission(
    payload: FlightMissionCreate = Body(...),
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightMissionOut:
    property_obj = _require_active_property(db, user.id, payload.property_id if payload.property_id is not None else property_id)
    mission_payload = _build_flight_mission_preview_payload(db, property_obj=property_obj, payload=payload)

    item = FlightMission(
        property_id=property_obj.id,
        name=mission_payload["name"],
        status=mission_payload["status"],
        field_ids_json=json.dumps(mission_payload["field_ids"], ensure_ascii=False),
        planning_unit_ids_json=json.dumps(mission_payload["planning_unit_ids"], ensure_ascii=False),
        drone_profile_id=mission_payload["drone_profile_id"],
        drone_profile_snapshot_json=json.dumps(mission_payload["drone_profile_snapshot"], ensure_ascii=False),
        estimated_duration_s=mission_payload["estimated_duration_s"],
        duration_status=mission_payload["duration_status"],
        parameters_json=json.dumps(mission_payload["parameters"], ensure_ascii=False),
        field_snapshots_json=json.dumps(mission_payload["fields"], ensure_ascii=False),
        route_geojson_json=json.dumps(mission_payload["route_geojson"], ensure_ascii=False),
        warnings_json=json.dumps(mission_payload["warnings"], ensure_ascii=False),
        export_manifest_json=json.dumps(mission_payload["export_manifest"], ensure_ascii=False),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _flight_mission_out(item)


@router.get("/flight-missions/{mission_id}", response_model=FlightMissionOut)
def get_flight_mission(
    mission_id: int,
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightMissionOut:
    item = _require_user_flight_mission(db, user_id=user.id, mission_id=mission_id)
    if property_id is not None and property_id != item.property_id:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")
    return _flight_mission_out(item)


@router.patch("/flight-missions/{mission_id}", response_model=FlightMissionOut)
def patch_flight_mission(
    mission_id: int,
    payload: FlightMissionPatch = Body(default_factory=FlightMissionPatch),
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightMissionOut:
    item = _require_user_flight_mission(db, user_id=user.id, mission_id=mission_id)
    if property_id is not None and property_id != item.property_id:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")
    if payload.property_id is not None and payload.property_id != item.property_id:
        raise HTTPException(status_code=400, detail="Et lagret flyoppdrag kan ikke flyttes til en annen eiendom")
    property_obj = _require_active_property(db, user.id, item.property_id)

    mission_payload = _build_flight_mission_preview_payload(db, property_obj=property_obj, payload=payload, existing=item)

    item.name = mission_payload["name"]
    item.status = mission_payload["status"]
    item.field_ids_json = json.dumps(mission_payload["field_ids"], ensure_ascii=False)
    item.planning_unit_ids_json = json.dumps(mission_payload["planning_unit_ids"], ensure_ascii=False)
    item.drone_profile_id = mission_payload["drone_profile_id"]
    item.drone_profile_snapshot_json = json.dumps(mission_payload["drone_profile_snapshot"], ensure_ascii=False)
    item.estimated_duration_s = mission_payload["estimated_duration_s"]
    item.duration_status = mission_payload["duration_status"]
    item.parameters_json = json.dumps(mission_payload["parameters"], ensure_ascii=False)
    item.field_snapshots_json = json.dumps(mission_payload["fields"], ensure_ascii=False)
    item.route_geojson_json = json.dumps(mission_payload["route_geojson"], ensure_ascii=False)
    item.warnings_json = json.dumps(mission_payload["warnings"], ensure_ascii=False)
    item.export_manifest_json = json.dumps(mission_payload["export_manifest"], ensure_ascii=False)
    item.last_generated_at = datetime.utcnow()

    db.commit()
    db.refresh(item)
    return _flight_mission_out(item)


@router.delete("/flight-missions/{mission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_flight_mission(
    mission_id: int,
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    item = _require_user_flight_mission(db, user_id=user.id, mission_id=mission_id)
    if property_id is not None and property_id != item.property_id:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")

    db.delete(item)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/flight-missions/{mission_id}/export")
def export_flight_mission(
    mission_id: int,
    property_id: int | None = Query(default=None),
    format: str = Query(default="auto"),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    item = _require_user_flight_mission(db, user_id=user.id, mission_id=mission_id)
    if property_id is not None and property_id != item.property_id:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")

    try:
        mission_name = item.name or f"Oppdrag {item.id}"
        route_geojson = json.loads(item.route_geojson_json)
        fields = json.loads(item.field_snapshots_json)
        export_manifest = json.loads(item.export_manifest_json)
        parameters = json.loads(item.parameters_json)
        drone_profile_snapshot = json.loads(item.drone_profile_snapshot_json or "{}")
        export_format = format.strip().lower()
        if export_format not in {"auto", "bundle", "dji-wpml", "dji-fly"}:
            raise HTTPException(status_code=400, detail="Ukjent eksportformat")

        if export_format in {"auto", "dji-wpml", "dji-fly"}:
            try:
                if export_format == "dji-fly":
                    export_bytes = build_flight_mission_dji_fly_kmz(
                        mission_id=item.id,
                        mission_name=mission_name,
                        route_geojson=route_geojson,
                        parameters=parameters,
                        drone_profile=drone_profile_snapshot,
                        export_manifest=export_manifest,
                    )
                    response_format = EXPORT_DJI_FLY_KMZ_FORMAT
                elif export_format == "dji-wpml":
                    export_bytes = build_flight_mission_dji_wpml_kmz(
                        mission_id=item.id,
                        mission_name=mission_name,
                        route_geojson=route_geojson,
                        parameters=parameters,
                        drone_profile=drone_profile_snapshot,
                        export_manifest=export_manifest,
                    )
                    response_format = EXPORT_DJI_WPML_FORMAT
                else:
                    try:
                        export_bytes = build_flight_mission_dji_wpml_kmz(
                            mission_id=item.id,
                            mission_name=mission_name,
                            route_geojson=route_geojson,
                            parameters=parameters,
                            drone_profile=drone_profile_snapshot,
                            export_manifest=export_manifest,
                        )
                        response_format = EXPORT_DJI_WPML_FORMAT
                    except ValueError:
                        export_bytes = build_flight_mission_dji_fly_kmz(
                            mission_id=item.id,
                            mission_name=mission_name,
                            route_geojson=route_geojson,
                            parameters=parameters,
                            drone_profile=drone_profile_snapshot,
                            export_manifest=export_manifest,
                        )
                        response_format = EXPORT_DJI_FLY_KMZ_FORMAT
                media_type = "application/vnd.google-earth.kmz"
                filename = f"flyvendebonder-oppdrag-{item.id}.kmz"
            except ValueError:
                if export_format in {"dji-wpml", "dji-fly"}:
                    raise
                export_bytes = build_flight_mission_export_bundle(
                    mission_id=item.id,
                    mission_name=mission_name,
                    fields=fields,
                    route_geojson=route_geojson,
                    export_manifest=export_manifest,
                )
                media_type = "application/zip"
                filename = f"flyvendebonder-oppdrag-{item.id}.zip"
                response_format = "bundle"
        else:
            export_bytes = build_flight_mission_export_bundle(
                mission_id=item.id,
                mission_name=mission_name,
                fields=fields,
                route_geojson=route_geojson,
                export_manifest=export_manifest,
            )
            media_type = "application/zip"
            filename = f"flyvendebonder-oppdrag-{item.id}.zip"
            response_format = "bundle"
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Oppdraget kan ikke eksporteres: {exc}") from exc
    expires_at = datetime.utcnow() + timedelta(minutes=5)
    response = Response(content=export_bytes, media_type=media_type)
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "private, max-age=300"
    response.headers["Expires"] = expires_at.strftime("%a, %d %b %Y %H:%M:%S GMT")
    response.headers["X-Flyvendebonder-Export-Format"] = response_format
    return response


@router.get("/flight-missions/{mission_id}/route.geojson")
def export_flight_mission_route_geojson(
    mission_id: int,
    property_id: int | None = Query(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    item = _require_user_flight_mission(db, user_id=user.id, mission_id=mission_id)
    if property_id is not None and property_id != item.property_id:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")

    route_geojson = json.loads(item.route_geojson_json)
    return _geojson_response(
        resource="flight_mission_route",
        export_path=f"/api/v1/flight-missions/{mission_id}/route.geojson",
        import_paths=["/api/v1/flight-missions", "/api/v1/flight-missions/{mission_id}"],
        features=route_geojson["features"],
        extra={
            "mission": {
                "id": item.id,
                "name": item.name or f"Oppdrag {item.id}",
                "property_id": item.property_id,
                "status": item.status,
            },
        },
    )


@router.get("/flight-captures", response_model=FlightCaptureListResponse)
def list_flight_captures(
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightCaptureListResponse:
    property_obj = _require_current_property(db, user.id)
    captures = (
        db.execute(
            select(FlightCapture)
            .options(selectinload(FlightCapture.processing_runs))
            .where(FlightCapture.property_id == property_obj.id)
            .order_by(FlightCapture.updated_at.desc(), FlightCapture.id.desc())
        )
        .scalars()
        .all()
    )
    return FlightCaptureListResponse(
        property_id=property_obj.id,
        count=len(captures),
        captures=[_flight_capture_out(db, item) for item in captures],
    )


@router.post("/flight-captures", response_model=FlightCaptureOut, status_code=status.HTTP_201_CREATED)
def create_flight_capture(
    payload: FlightCaptureCreate = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightCaptureOut:
    property_obj = _require_current_property(db, user.id)
    photos = _resolve_flight_capture_photos(db, user_id=user.id, property_obj=property_obj, photo_ids=payload.photo_ids)

    mission = None
    field_ids: list[int] = []
    if payload.mission_id is not None:
        mission = (
            db.execute(
                select(FlightMission).where(
                    FlightMission.id == payload.mission_id,
                    FlightMission.property_id == property_obj.id,
                )
            )
            .scalars()
            .first()
        )
        if mission is None:
            raise HTTPException(status_code=404, detail="Fant ikke oppdrag for flight capture")
        field_ids = json.loads(mission.field_ids_json)

    captured_from, captured_to = build_capture_summary(photos)
    _photo_summary = build_capture_photo_summary(photos)
    item = FlightCapture(
        user_id=user.id,
        property_id=property_obj.id,
        mission_id=mission.id if mission else None,
        name=_normalize_field_name(payload.name) or (mission.name if mission else None),
        source="mission" if mission and payload.source == "manual" else payload.source,
        status="ready",
        photo_ids_json=json.dumps([photo.id for photo in photos], ensure_ascii=False),
        photo_count=len(photos),
        field_ids_json=json.dumps(field_ids, ensure_ascii=False),
        captured_from=captured_from,
        captured_to=captured_to,
        notes=_normalize_field_name(payload.notes),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    db.refresh(item, attribute_names=["processing_runs"])
    return _flight_capture_out(db, item)


@router.get("/flight-captures/{capture_id}", response_model=FlightCaptureOut)
def get_flight_capture(
    capture_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FlightCaptureOut:
    property_obj = _require_current_property(db, user.id)
    item = _resolve_flight_capture(db, property_obj=property_obj, capture_id=capture_id)
    return _flight_capture_out(db, item)


@router.get("/processing-runs", response_model=ProcessingRunListResponse)
def list_processing_runs(
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingRunListResponse:
    property_obj = _require_current_property(db, user.id)
    runs = (
        db.execute(
            select(ProcessingRun)
            .join(FlightCapture, ProcessingRun.capture_id == FlightCapture.id)
            .options(selectinload(ProcessingRun.artifacts))
            .where(FlightCapture.property_id == property_obj.id)
            .order_by(ProcessingRun.updated_at.desc(), ProcessingRun.id.desc())
        )
        .scalars()
        .all()
    )
    return ProcessingRunListResponse(
        property_id=property_obj.id,
        count=len(runs),
        runs=[_processing_run_out(item) for item in runs],
    )


@router.post("/processing-runs", response_model=ProcessingRunOut, status_code=status.HTTP_201_CREATED)
def create_processing_run(
    payload: ProcessingRunCreate = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingRunOut:
    property_obj = _require_current_property(db, user.id)
    capture = _resolve_flight_capture(db, property_obj=property_obj, capture_id=payload.capture_id)

    input_manifest = build_processing_input_manifest(
        capture=capture,
        provider=payload.provider,
        requested_outputs=payload.requested_outputs,
        provider_config=payload.provider_config,
    )
    item = ProcessingRun(
        capture_id=capture.id,
        provider=payload.provider.strip(),
        status="queued",
        requested_outputs_json=json.dumps(payload.requested_outputs, ensure_ascii=False),
        provider_config_json=json.dumps(payload.provider_config, ensure_ascii=False),
        input_manifest_json=json.dumps(input_manifest, ensure_ascii=False),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    db.refresh(item, attribute_names=["artifacts"])
    return _processing_run_out(item)


@router.get("/processing-runs/{run_id}", response_model=ProcessingRunOut)
def get_processing_run(
    run_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingRunOut:
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(ProcessingRun)
            .join(FlightCapture, ProcessingRun.capture_id == FlightCapture.id)
            .options(selectinload(ProcessingRun.artifacts))
            .where(ProcessingRun.id == run_id, FlightCapture.property_id == property_obj.id)
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke processing-run")
    return _processing_run_out(item)


@router.patch("/processing-runs/{run_id}", response_model=ProcessingRunOut)
def patch_processing_run(
    run_id: int,
    payload: ProcessingRunPatch = Body(default_factory=ProcessingRunPatch),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingRunOut:
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(ProcessingRun)
            .join(FlightCapture, ProcessingRun.capture_id == FlightCapture.id)
            .options(selectinload(ProcessingRun.artifacts))
            .where(ProcessingRun.id == run_id, FlightCapture.property_id == property_obj.id)
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke processing-run")

    if payload.status is not None:
        item.status = payload.status
        item.started_at = processing_run_should_start(payload.status, item.started_at)
        item.finished_at = processing_run_should_finish(payload.status, item.finished_at)
        item.last_synced_at = datetime.utcnow()
    if payload.external_job_id is not None:
        item.external_job_id = payload.external_job_id.strip() or None
    if payload.error_detail is not None:
        item.error_detail = payload.error_detail.strip() or None
    if payload.provider_config is not None:
        item.provider_config_json = json.dumps(payload.provider_config, ensure_ascii=False)

    db.commit()
    db.refresh(item)
    db.refresh(item, attribute_names=["artifacts"])
    return _processing_run_out(item)


@router.get("/processing-runs/{run_id}/artifacts", response_model=ProcessingArtifactListResponse)
def list_processing_artifacts(
    run_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingArtifactListResponse:
    property_obj = _require_current_property(db, user.id)
    run = (
        db.execute(
            select(ProcessingRun)
            .join(FlightCapture, ProcessingRun.capture_id == FlightCapture.id)
            .options(selectinload(ProcessingRun.artifacts))
            .where(ProcessingRun.id == run_id, FlightCapture.property_id == property_obj.id)
        )
        .scalars()
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Fant ikke processing-run")
    return ProcessingArtifactListResponse(
        processing_run_id=run.id,
        count=len(run.artifacts),
        artifacts=[_processing_artifact_out(item) for item in run.artifacts],
    )


@router.post(
    "/processing-runs/{run_id}/artifacts",
    response_model=ProcessingArtifactOut,
    status_code=status.HTTP_201_CREATED,
)
def create_processing_artifact(
    run_id: int,
    payload: ProcessingArtifactCreate = Body(...),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> ProcessingArtifactOut:
    property_obj = _require_current_property(db, user.id)
    run = (
        db.execute(
            select(ProcessingRun)
            .join(FlightCapture, ProcessingRun.capture_id == FlightCapture.id)
            .options(selectinload(ProcessingRun.artifacts))
            .where(ProcessingRun.id == run_id, FlightCapture.property_id == property_obj.id)
        )
        .scalars()
        .first()
    )
    if run is None:
        raise HTTPException(status_code=404, detail="Fant ikke processing-run")

    if payload.ingest_run_id is not None:
        ingest_run = (
            db.execute(
                select(IngestRun).where(
                    IngestRun.id == payload.ingest_run_id,
                    IngestRun.user_id == user.id,
                )
            )
            .scalars()
            .first()
        )
        if ingest_run is None:
            raise HTTPException(status_code=404, detail="Fant ikke importkjøring")

    item = ProcessingArtifact(
        processing_run_id=run.id,
        ingest_run_id=payload.ingest_run_id,
        kind=payload.kind,
        format=payload.format,
        uri=payload.uri.strip(),
        source_ref=payload.source_ref.strip() if payload.source_ref else None,
        bytes=payload.bytes,
        checksum=payload.checksum.strip() if payload.checksum else None,
        is_public=payload.is_public,
        metadata_json=json.dumps(payload.metadata, ensure_ascii=False),
        provenance_json=json.dumps(
            {
                "capture_id": run.capture_id,
                "processing_run_id": run.id,
                "source_ref": payload.source_ref.strip() if payload.source_ref else None,
                **payload.provenance,
            },
            ensure_ascii=False,
        ),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _processing_artifact_out(item)


@router.get("/stac/collections", response_model=StacCollectionListResponse)
def list_stac_collections(
    request: Request,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> StacCollectionListResponse:
    property_obj = _require_current_property(db, user.id)
    captures = (
        db.execute(
            select(FlightCapture)
            .options(selectinload(FlightCapture.processing_runs).selectinload(ProcessingRun.artifacts))
            .where(FlightCapture.property_id == property_obj.id)
            .order_by(FlightCapture.updated_at.desc(), FlightCapture.id.desc())
        )
        .scalars()
        .all()
    )
    collections: list[StacCollectionOut] = []
    for capture in captures:
        items = _stac_items_for_capture(request, db, property_obj, capture)
        if not items:
            continue
        collections.append(_stac_collection_out(request, capture, items))

    return StacCollectionListResponse(
        collections=collections,
        links=[StacLink(rel="self", href=_stac_href(request, "/api/v1/stac/collections"), type="application/json")],
    )


@router.get("/stac/collections/{collection_id}", response_model=StacCollectionOut)
def get_stac_collection(
    collection_id: str,
    request: Request,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> StacCollectionOut:
    property_obj = _require_current_property(db, user.id)
    capture = _resolve_stac_capture(db, property_obj, collection_id)
    items = _stac_items_for_capture(request, db, property_obj, capture)
    return _stac_collection_out(request, capture, items)


@router.get("/stac/collections/{collection_id}/items", response_model=StacItemCollectionOut)
def list_stac_items(
    collection_id: str,
    request: Request,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> StacItemCollectionOut:
    property_obj = _require_current_property(db, user.id)
    capture = _resolve_stac_capture(db, property_obj, collection_id)
    items = _stac_items_for_capture(request, db, property_obj, capture)
    return StacItemCollectionOut(
        type="FeatureCollection",
        features=items,
        links=[StacLink(rel="self", href=_stac_href(request, f"/api/v1/stac/collections/{collection_id}/items"), type="application/geo+json")],
    )


@router.get("/stac/collections/{collection_id}/items/{item_id}", response_model=StacItemOut)
def get_stac_item(
    collection_id: str,
    item_id: str,
    request: Request,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> StacItemOut:
    property_obj = _require_current_property(db, user.id)
    capture = _resolve_stac_capture(db, property_obj, collection_id)
    items = _stac_items_for_capture(request, db, property_obj, capture)
    for item in items:
        if item.id == item_id:
            return item
    raise HTTPException(status_code=404, detail="Fant ikke STAC-item")
@router.get("/photos", response_model=PhotoResponse)
def get_photos(
    user_id: int | None = Query(default=None),
    date: date_type | None = Query(default=None),
    mode: str = Query(default="day", pattern="^(day|cumulative)$"),
    include_analysis: bool = Query(default=False),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoResponse:
    user_id = _session_user_id(user, user_id)

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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoPageResponse:
    user_id = _session_user_id(user, user_id)

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


@router.get("/photos/{photo_id}", response_model=PhotoFeature)
def get_photo(
    photo_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoFeature:
    photo = load_photo_by_id(db, user_id=user.id, photo_id=photo_id)
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke foto")
    return PhotoFeature(**photo)


@router.get("/photos/{photo_id}/assets", response_model=PhotoAssetListResponse)
def get_photo_assets(
    photo_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoAssetListResponse:
    photo = (
        db.execute(select(Photo).options(selectinload(Photo.assets)).where(Photo.id == photo_id, Photo.user_id == user.id))
        .scalars()
        .first()
    )
    if photo is None:
        raise HTTPException(status_code=404, detail="Fant ikke foto")

    assets = sorted(photo.assets, key=lambda item: (item.kind != "original", item.kind, item.id))
    return PhotoAssetListResponse(
        photo_id=photo.id,
        count=len(assets),
        assets=[_photo_asset_out(item) for item in assets],
    )


@router.post("/photos/{photo_id}/approve-analysis", response_model=PhotoAnalysisActionResponse)
def approve_photo_analysis(
    photo_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoAnalysisActionResponse:
    photo = db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.user_id == user.id)
    ).scalar_one_or_none()
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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoAnalysisActionResponse:
    photo = db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.user_id == user.id)
    ).scalar_one_or_none()
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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoMetadataActionResponse:
    photo = db.execute(
        select(Photo).where(Photo.id == photo_id, Photo.user_id == user.id)
    ).scalar_one_or_none()
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
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoAnalysisRefreshResponse:
    user_id = _session_user_id(user, user_id)

    results = rebuild_photo_analysis_for_user(db, user_id=user_id, force=force)
    return PhotoAnalysisRefreshResponse(**results)


@router.post("/maintenance/reprocess-photos", response_model=PhotoReprocessResponse)
def reprocess_photo_metadata(
    user_id: int | None = Query(default=None),
    refresh_analysis: bool = Query(default=True),
    force_analysis: bool = Query(default=True),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> PhotoReprocessResponse:
    user_id = _session_user_id(user, user_id)

    results = reprocess_photos_for_user(
        db,
        user_id=user_id,
        refresh_analysis=refresh_analysis,
        force_analysis=force_analysis,
    )
    return PhotoReprocessResponse(**results)


@router.get("/sources/status", response_model=SourceStatusResponse)
def get_source_status(
    _user: User = Depends(_request_owner_user),
) -> SourceStatusResponse:
    ar5_configured = _configured_layer(
        settings.photo_ar5_wms_url,
        settings.photo_ar5_wms_layers,
        settings.photo_ar5_wfs_url,
        settings.photo_ar5_wfs_layers,
    )
    soil_configured = _configured_layer(
        settings.photo_soil_wms_url,
        settings.photo_soil_wms_layers,
        settings.photo_soil_wfs_url,
        settings.photo_soil_wfs_layers,
    )

    return SourceStatusResponse(
        ar5=_source_layer_status(
            enabled=settings.photo_ar5_enabled and ar5_configured,
            configured=ar5_configured,
            enabled_desc="AR5-oppslag er aktivert for dette miljøet.",
            disabled_desc="AR5 er deaktivert som sikker default. Sett PHOTO_AR5_ENABLED=true bare ved avklart tilgang.",
        ),
        gardskart=_source_layer_status(
            enabled=settings.nibio_gardskart_enabled,
            configured=bool(settings.nibio_gpiareastat_url),
            enabled_desc="Gårdskart jobId-henting er aktivert for dette miljøet.",
            disabled_desc="Gårdskart er deaktivert som sikker default. Sett NIBIO_GARDSKART_ENABLED=true bare ved avklart tilgang.",
        ),
        soil=_source_layer_status(
            enabled=soil_configured,
            configured=soil_configured,
            enabled_desc="Jordsmonn/jordkvalitet er konfigurert som eksplisitt analysekontekst.",
            disabled_desc="Jordsmonn/jordkvalitet er deaktivert fordi ingen WMS/WFS-kilde er konfigurert.",
        ),
    )


@router.get("/properties/current")
def get_current_property_endpoint(
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> dict:
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    return {"property": PropertyOut.model_validate(property_obj)}


@router.get("/properties/current/gardskart-job", response_model=GardskartJobResponse)
async def get_current_gardskart_job(
    force_refresh: bool = Query(default=False),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> GardskartJobResponse:
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    return await _build_gardskart_job_response(db, property_obj, force_refresh=force_refresh)


@router.get("/properties/current/field-candidates", response_model=FieldCandidateListResponse)
async def get_current_property_field_candidates(
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    try:
        fields = await list_field_candidates_for_property(property_obj)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge teigoppslag feilet",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente teiger fra Geonorge: {exc}") from exc

    return _field_candidate_response(property_obj.id, fields)


@router.get("/properties/current/field-candidates/by-point", response_model=FieldCandidateListResponse)
async def get_current_property_field_candidates_by_point(
    lat: float = Query(..., ge=-90.0, le=90.0),
    lng: float = Query(..., ge=-180.0, le=180.0),
    radius_m: int = Query(default=settings.geonorge_point_lookup_radius_m, ge=1, le=3000),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    property_obj = _current_property(db, user.id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ingen aktiv eiendom")

    try:
        fields = await lookup_field_candidates_by_point(property_obj, lat=lat, lng=lng, radius_m=radius_m)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge punktoppslag feilet",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente teiger fra Geonorge: {exc}") from exc

    return _field_candidate_response(property_obj.id, fields)


@router.get("/properties/{property_id}/gardskart-job", response_model=GardskartJobResponse)
async def get_property_gardskart_job(
    property_id: int,
    force_refresh: bool = Query(default=False),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> GardskartJobResponse:
    property_obj = _active_property_by_id(db, user.id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")

    return await _build_gardskart_job_response(db, property_obj, force_refresh=force_refresh)


@router.get("/properties/{property_id}/field-candidates", response_model=FieldCandidateListResponse)
async def get_property_field_candidates(
    property_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    property_obj = _active_property_by_id(db, user.id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")

    try:
        fields = await list_field_candidates_for_property(property_obj)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge teigoppslag feilet",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente teiger fra Geonorge: {exc}") from exc

    return _field_candidate_response(property_obj.id, fields)


@router.get("/properties/{property_id}/field-candidates/by-point", response_model=FieldCandidateListResponse)
async def get_property_field_candidates_by_point(
    property_id: int,
    lat: float = Query(..., ge=-90.0, le=90.0),
    lng: float = Query(..., ge=-180.0, le=180.0),
    radius_m: int = Query(default=settings.geonorge_point_lookup_radius_m, ge=1, le=3000),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    property_obj = _active_property_by_id(db, user.id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")

    try:
        fields = await lookup_field_candidates_by_point(property_obj, lat=lat, lng=lng, radius_m=radius_m)
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "Geonorge punktoppslag feilet",
            extra={"property_id": property_obj.id, "error": str(exc)},
        )
        raise HTTPException(status_code=502, detail=f"Kunne ikke hente teiger fra Geonorge: {exc}") from exc

    return _field_candidate_response(property_obj.id, fields)


@router.post("/imports/photos")
def post_import_photos(
    payload: ImportRequest = Body(default_factory=ImportRequest),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> dict:
    source = Path(payload.source_path) if payload.source_path else settings.imports_default_source
    property_obj = _current_property(db, user.id)
    try:
        run = run_photo_ingest(
            db,
            source,
            user_id=user.id,
            property_id=property_obj.id if property_obj else None,
            include_files=payload.include_files,
        )
    except ImportSelectionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"import_run": ImportRunOut.model_validate(run)}


@router.get("/imports/{run_id}")
def get_import_run(
    run_id: int,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> dict:
    run = db.execute(
        select(IngestRun).where(IngestRun.id == run_id, IngestRun.user_id == user.id)
    ).scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Fant ikke ingest-run")
    return {"import_run": ImportRunOut.model_validate(run)}


@router.post("/media-staging-jobs", response_model=MediaStagingEnvelope, status_code=status.HTTP_201_CREATED)
async def create_media_staging_job(
    files: list[UploadFile] = File(...),
    source_paths: str | None = Form(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> MediaStagingEnvelope:
    if not files:
        raise HTTPException(status_code=400, detail="Minst én fil må lastes opp")

    property_obj = _current_property(db, user.id)
    try:
        job = await create_media_staging_job_record(
            db,
            app_data_root=settings.app_data_root,
            user_id=user.id,
            property_id=property_obj.id if property_obj else None,
            files=files,
            source_paths=source_paths,
        )
    except StagingUploadTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return MediaStagingEnvelope(job=_media_staging_job_out(job))


@router.get("/media-staging-jobs", response_model=MediaStagingJobListResponse)
def list_media_staging_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> MediaStagingJobListResponse:
    jobs = list_media_staging_jobs_record(db, user_id=user.id, limit=limit)
    return MediaStagingJobListResponse(count=len(jobs), jobs=[_media_staging_job_out(item) for item in jobs])


@router.get("/media-staging-jobs/{job_id}", response_model=MediaStagingEnvelope)
def get_media_staging_job(
    job_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> MediaStagingEnvelope:
    job = _require_media_staging_job(db, user_id=user.id, job_id=job_id)
    return MediaStagingEnvelope(job=_media_staging_job_out(job))


@router.post("/media-staging-jobs/{job_id}/finalize", response_model=MediaFinalizeEnvelope)
def finalize_media_staging_job(
    job_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> MediaFinalizeEnvelope:
    try:
        result = finalize_media_staging_job_record(
            db,
            app_data_root=settings.app_data_root,
            user_id=user.id,
            job_id=job_id,
        )
    except ValueError as exc:
        detail = str(exc)
        if detail == "Fant ikke stagingjobb":
            raise HTTPException(status_code=404, detail=detail) from exc
        raise HTTPException(status_code=400, detail=detail) from exc
    return MediaFinalizeEnvelope(result=result)


@router.post("/video-jobs", response_model=VideoJobEnvelope, status_code=status.HTTP_201_CREATED)
async def create_video_job(
    file: UploadFile = File(...),
    mode: str = Form(default="frames"),
    config: str | None = Form(default=None),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> VideoJobEnvelope:
    normalized_mode = (mode or "").strip().lower() or "frames"
    if normalized_mode not in {"frames", "map3d"}:
        raise HTTPException(status_code=400, detail="Ugyldig videomodus")

    parsed_config: dict[str, object] = {}
    if config:
        try:
            raw_config = json.loads(config)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=400, detail="config må være gyldig JSON") from exc
        if raw_config is None:
            parsed_config = {}
        elif isinstance(raw_config, dict):
            parsed_config = raw_config
        else:
            raise HTTPException(status_code=400, detail="config må være et objekt")

    filename = Path(file.filename or "video-upload").name or "video-upload"
    await file.close()

    property_obj = _current_property(db, user.id)

    job = create_video_job_record(
        db,
        app_data_root=settings.app_data_root,
        user_id=user.id,
        property_id=property_obj.id if property_obj else None,
        filename=filename,
        mode=normalized_mode,
        config=parsed_config,
    )
    return VideoJobEnvelope(job=_video_job_out(job))


@router.get("/video-jobs", response_model=VideoJobListResponse)
def list_video_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    mode: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> VideoJobListResponse:
    normalized_mode = mode.strip().lower() if mode else None
    normalized_status = status_filter.strip().lower() if status_filter else None
    if normalized_mode is not None and normalized_mode not in {"frames", "map3d"}:
        raise HTTPException(status_code=400, detail="Ugyldig videomodus")
    if normalized_status is not None and normalized_status not in {"pending", "processing", "done", "failed"}:
        raise HTTPException(status_code=400, detail="Ugyldig videostatus")

    jobs = list_video_job_records(
        db,
        user_id=user.id,
        limit=limit,
        mode=normalized_mode,
        status=normalized_status,
    )
    return VideoJobListResponse(count=len(jobs), jobs=[_video_job_out(item) for item in jobs])


@router.get("/video-jobs/{job_id}", response_model=VideoJobEnvelope)
def get_video_job(
    job_id: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> VideoJobEnvelope:
    job = _require_video_job(db, user_id=user.id, job_id=job_id)
    return VideoJobEnvelope(job=_video_job_out(job))


@router.put("/video-jobs/{job_id}/review", response_model=VideoJobReviewOut)
def put_video_job_review(
    job_id: str,
    payload: VideoJobReviewIn,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> VideoJobReviewOut:
    _require_video_job(db, user_id=user.id, job_id=job_id)
    review = save_video_job_review(
        db,
        job_id=job_id,
        created_at=payload.created_at,
        mode=payload.mode,
        review_state=payload.review_state,
        placement=payload.placement.model_dump() if payload.placement else None,
    )
    if review is None:
        raise HTTPException(status_code=404, detail="Fant ikke videojobb")
    return VideoJobReviewOut.model_validate(
        {
            "job_id": review.job_id,
            "created_at": review.created_at,
            "mode": review.mode,
            "review_state": review.review_state,
            "placement": json.loads(review.placement_json) if review.placement_json else None,
            "reviewed_at": review.reviewed_at,
        }
    )


@router.get("/video-jobs/{job_id}/{artifact_name}")
def get_video_job_artifact(
    job_id: str,
    artifact_name: str,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    media_type = _VIDEO_JOB_ARTIFACT_MEDIA_TYPES.get(artifact_name)
    if media_type is None:
        raise HTTPException(status_code=404, detail="Fant ikke videoartefakt")

    _require_video_job(db, user_id=user.id, job_id=job_id)
    target = _video_job_artifact_path(job_id, artifact_name)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fant ikke videoartefakt")

    return FileResponse(target, media_type=media_type)


@router.get("/assets/{asset_path:path}")
def get_asset(
    asset_path: str,
    request: Request,
    user: User = Depends(_request_owner_user),
    db: Session = Depends(get_db),
) -> Response:
    root = settings.app_data_root.resolve()
    target = (root / asset_path).resolve()

    if root != target and root not in target.parents:
        raise HTTPException(status_code=403, detail="Ugyldig filsti")

    normalized = asset_path.strip("/")
    allowed_roots = {
        "thumb": (root / "photos" / "thumb").resolve(),
        "web": (root / "photos" / "web").resolve(),
        "original": (root / "photos" / "original").resolve(),
    }
    asset_kind = next(
        (kind for kind in allowed_roots if normalized.startswith(f"photos/{kind}/")),
        None,
    )
    if asset_kind is None:
        raise HTTPException(status_code=404, detail="Fant ikke fil")
    allowed_root = allowed_roots[asset_kind]
    if allowed_root not in target.parents:
        raise HTTPException(status_code=404, detail="Fant ikke fil")
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fant ikke fil")

    owned_asset = (
        db.execute(
            select(PhotoAsset.id)
            .join(Photo, Photo.id == PhotoAsset.photo_id)
            .where(PhotoAsset.path == normalized, Photo.user_id == user.id)
            .limit(1)
        )
        .scalars()
        .first()
    )
    if owned_asset is None:
        raise HTTPException(status_code=404, detail="Fant ikke fil")

    if asset_kind in {"thumb", "web"}:
        cache_control = "private, max-age=31536000, immutable"
    else:
        cache_control = "private, max-age=3600"

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
