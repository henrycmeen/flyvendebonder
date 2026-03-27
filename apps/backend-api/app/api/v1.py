from __future__ import annotations

import json
import logging
import math
import os
import time
from datetime import timedelta
from datetime import date as date_type, datetime
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from ..config import get_settings
from ..database import get_db
from ..logging_utils import read_recent_logs, request_id_ctx
from ..models import (
    FieldPlot,
    FlightCapture,
    FlightMission,
    IngestRun,
    MediaStagingJob,
    Photo,
    PhotoAnalysis,
    ProcessingArtifact,
    ProcessingRun,
    Property,
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
    FieldPlotCreate,
    FieldPlotDeleteResponse,
    FieldPlotListResponse,
    FieldPlotOut,
    FieldPlotPatch,
    GardskartJobResponse,
    PhotoAnalysisActionResponse,
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
    MediaStagingItemOut,
    MediaStagingJobListResponse,
    MediaStagingJobOut,
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
    admin_access_is_configured,
    clear_admin_session,
    get_admin_session,
    issue_admin_session,
    require_admin_session,
    verify_admin_access_code,
)
from ..services.gardskart import get_job_id
from ..services.geonorge_teiger import (
    list_field_candidates_for_property,
    lookup_field_candidates_by_point,
)
from ..services.imports import run_photo_ingest
from ..services.media_staging import (
    create_media_staging_job as create_media_staging_job_record,
    finalize_media_staging_job as finalize_media_staging_job_record,
    get_media_staging_job as get_media_staging_job_record,
    list_media_staging_jobs as list_media_staging_jobs_record,
)
from ..services.analysis_enrich import enrich_photo, rebuild_photo_analysis_for_user
from ..services.field_plots import normalize_polygon_coordinates, polygon_area_m2
from ..services.flight_missions import (
    build_flight_mission_export_bundle,
    build_flight_mission_payload,
)
from ..services.photo_reprocess import reprocess_photos_for_user
from ..services.photos import load_photos_for_date, load_photos_page, timeline_dates
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


def _media_staging_job_out(job: MediaStagingJob) -> MediaStagingJobOut:
    items = [
        MediaStagingItemOut(
            id=item.id,
            filename=item.filename,
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
        job_id=job.id,
        source=job.source,
        status=job.status,
        counts=counts,
        items=items,
        created_at=job.created_at,
        updated_at=job.updated_at,
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
    return FlightMissionOut(
        id=item.id,
        property_id=item.property_id,
        name=(item.name or f"Oppdrag {item.id}").strip(),
        status=item.status,
        field_ids=json.loads(item.field_ids_json),
        parameters=json.loads(item.parameters_json),
        fields=json.loads(item.field_snapshots_json),
        warnings=json.loads(item.warnings_json),
        route_geojson=json.loads(item.route_geojson_json),
        export_manifest=json.loads(item.export_manifest_json),
        created_at=item.created_at,
        updated_at=item.updated_at,
        last_generated_at=item.last_generated_at,
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
        kind=item.kind,
        format=item.format,
        uri=item.uri,
        bytes=item.bytes,
        checksum=item.checksum,
        is_public=item.is_public,
        metadata=json.loads(item.metadata_json),
        provenance=json.loads(item.provenance_json),
        public_url=artifact_public_url(item),
        created_at=item.created_at,
        updated_at=item.updated_at,
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


@router.get("/fields/export.geojson")
def export_field_plots_geojson(
    status_filter: str | None = Query(default=None, alias="status"),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> Response:
    user = _current_user(db)
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


@router.get("/flight-missions", response_model=FlightMissionListResponse)
def list_flight_missions(db: Session = Depends(get_db)) -> FlightMissionListResponse:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
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


@router.post("/flight-missions", response_model=FlightMissionOut, status_code=status.HTTP_201_CREATED)
def create_flight_mission(
    payload: FlightMissionCreate = Body(...),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FlightMissionOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    field_items = _resolve_field_plots_for_mission(db, property_obj, payload.field_ids)
    mission_payload = build_flight_mission_payload(
        property_obj=property_obj,
        fields=field_items,
        name=payload.name,
        parameters=payload.parameters.model_dump(),
    )

    item = FlightMission(
        property_id=property_obj.id,
        name=mission_payload["name"],
        status=mission_payload["status"],
        field_ids_json=json.dumps(mission_payload["field_ids"], ensure_ascii=False),
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
def get_flight_mission(mission_id: int, db: Session = Depends(get_db)) -> FlightMissionOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(FlightMission).where(
                FlightMission.id == mission_id,
                FlightMission.property_id == property_obj.id,
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")
    return _flight_mission_out(item)


@router.patch("/flight-missions/{mission_id}", response_model=FlightMissionOut)
def patch_flight_mission(
    mission_id: int,
    payload: FlightMissionPatch = Body(default_factory=FlightMissionPatch),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FlightMissionOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(FlightMission).where(
                FlightMission.id == mission_id,
                FlightMission.property_id == property_obj.id,
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")

    field_ids = payload.field_ids if payload.field_ids is not None else json.loads(item.field_ids_json)
    parameters = json.loads(item.parameters_json)
    if payload.parameters is not None:
        parameters = {
            **parameters,
            **payload.parameters.model_dump(exclude_unset=True),
        }
    mission_payload = build_flight_mission_payload(
        property_obj=property_obj,
        fields=_resolve_field_plots_for_mission(db, property_obj, field_ids),
        name=payload.name if "name" in payload.model_fields_set else item.name,
        parameters=parameters,
    )

    item.name = mission_payload["name"]
    item.status = mission_payload["status"]
    item.field_ids_json = json.dumps(mission_payload["field_ids"], ensure_ascii=False)
    item.parameters_json = json.dumps(mission_payload["parameters"], ensure_ascii=False)
    item.field_snapshots_json = json.dumps(mission_payload["fields"], ensure_ascii=False)
    item.route_geojson_json = json.dumps(mission_payload["route_geojson"], ensure_ascii=False)
    item.warnings_json = json.dumps(mission_payload["warnings"], ensure_ascii=False)
    item.export_manifest_json = json.dumps(mission_payload["export_manifest"], ensure_ascii=False)
    item.last_generated_at = datetime.utcnow()

    db.commit()
    db.refresh(item)
    return _flight_mission_out(item)


@router.post("/flight-missions/{mission_id}/export")
def export_flight_mission(
    mission_id: int,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> Response:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(FlightMission).where(
                FlightMission.id == mission_id,
                FlightMission.property_id == property_obj.id,
            )
        )
        .scalars()
        .first()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Fant ikke oppdrag")

    try:
        export_bytes = build_flight_mission_export_bundle(
            mission_id=item.id,
            mission_name=(item.name or f"Oppdrag {item.id}"),
            fields=json.loads(item.field_snapshots_json),
            route_geojson=json.loads(item.route_geojson_json),
            export_manifest=json.loads(item.export_manifest_json),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Oppdraget kan ikke eksporteres: {exc}") from exc
    expires_at = datetime.utcnow() + timedelta(minutes=5)
    filename = f"flyvendebonder-oppdrag-{item.id}.zip"
    response = Response(content=export_bytes, media_type="application/zip")
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    response.headers["Cache-Control"] = "private, max-age=300"
    response.headers["Expires"] = expires_at.strftime("%a, %d %b %Y %H:%M:%S GMT")
    return response


@router.get("/flight-missions/{mission_id}/route.geojson")
def export_flight_mission_route_geojson(
    mission_id: int,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> Response:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = (
        db.execute(
            select(FlightMission).where(
                FlightMission.id == mission_id,
                FlightMission.property_id == property_obj.id,
            )
        )
        .scalars()
        .first()
    )
    if item is None:
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
def list_flight_captures(db: Session = Depends(get_db)) -> FlightCaptureListResponse:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> FlightCaptureOut:
    user = _current_user(db)
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
def get_flight_capture(capture_id: int, db: Session = Depends(get_db)) -> FlightCaptureOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    item = _resolve_flight_capture(db, property_obj=property_obj, capture_id=capture_id)
    return _flight_capture_out(db, item)


@router.get("/processing-runs", response_model=ProcessingRunListResponse)
def list_processing_runs(db: Session = Depends(get_db)) -> ProcessingRunListResponse:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> ProcessingRunOut:
    user = _current_user(db)
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
def get_processing_run(run_id: int, db: Session = Depends(get_db)) -> ProcessingRunOut:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> ProcessingRunOut:
    user = _current_user(db)
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
def list_processing_artifacts(run_id: int, db: Session = Depends(get_db)) -> ProcessingArtifactListResponse:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> ProcessingArtifactOut:
    user = _current_user(db)
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

    item = ProcessingArtifact(
        processing_run_id=run.id,
        kind=payload.kind,
        format=payload.format,
        uri=payload.uri.strip(),
        bytes=payload.bytes,
        checksum=payload.checksum.strip() if payload.checksum else None,
        is_public=payload.is_public,
        metadata_json=json.dumps(payload.metadata, ensure_ascii=False),
        provenance_json=json.dumps(payload.provenance, ensure_ascii=False),
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _processing_artifact_out(item)


@router.get("/stac/collections", response_model=StacCollectionListResponse)
def list_stac_collections(request: Request, db: Session = Depends(get_db)) -> StacCollectionListResponse:
    user = _current_user(db)
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
def get_stac_collection(collection_id: str, request: Request, db: Session = Depends(get_db)) -> StacCollectionOut:
    user = _current_user(db)
    property_obj = _require_current_property(db, user.id)
    capture = _resolve_stac_capture(db, property_obj, collection_id)
    items = _stac_items_for_capture(request, db, property_obj, capture)
    return _stac_collection_out(request, capture, items)


@router.get("/stac/collections/{collection_id}/items", response_model=StacItemCollectionOut)
def list_stac_items(collection_id: str, request: Request, db: Session = Depends(get_db)) -> StacItemCollectionOut:
    user = _current_user(db)
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
    db: Session = Depends(get_db),
) -> StacItemOut:
    user = _current_user(db)
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


@router.post("/maintenance/reprocess-photos", response_model=PhotoReprocessResponse)
def reprocess_photo_metadata(
    user_id: int | None = Query(default=None),
    refresh_analysis: bool = Query(default=True),
    force_analysis: bool = Query(default=True),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> PhotoReprocessResponse:
    if user_id is None:
        user_id = _current_user(db).id

    results = reprocess_photos_for_user(
        db,
        user_id=user_id,
        refresh_analysis=refresh_analysis,
        force_analysis=force_analysis,
    )
    return PhotoReprocessResponse(**results)


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


@router.get("/properties/current/field-candidates", response_model=FieldCandidateListResponse)
async def get_current_property_field_candidates(db: Session = Depends(get_db)) -> FieldCandidateListResponse:
    user = _current_user(db)
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
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    user = _current_user(db)
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
    db: Session = Depends(get_db),
) -> GardskartJobResponse:
    user = _current_user(db)
    property_obj = _active_property_by_id(db, user.id, property_id)
    if property_obj is None:
        raise HTTPException(status_code=404, detail="Fant ikke aktiv eiendom")

    return await _build_gardskart_job_response(db, property_obj, force_refresh=force_refresh)


@router.get("/properties/{property_id}/field-candidates", response_model=FieldCandidateListResponse)
async def get_property_field_candidates(
    property_id: int,
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    user = _current_user(db)
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
    db: Session = Depends(get_db),
) -> FieldCandidateListResponse:
    user = _current_user(db)
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


@router.post("/media-staging-jobs", response_model=MediaStagingEnvelope, status_code=status.HTTP_201_CREATED)
async def create_media_staging_job(
    files: list[UploadFile] = File(...),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> MediaStagingEnvelope:
    if not files:
        raise HTTPException(status_code=400, detail="Minst én fil må lastes opp")

    user = _current_user(db)
    property_obj = _current_property(db, user.id)
    job = await create_media_staging_job_record(
        db,
        app_data_root=settings.app_data_root,
        user_id=user.id,
        property_id=property_obj.id if property_obj else None,
        files=files,
    )
    return MediaStagingEnvelope(job=_media_staging_job_out(job))


@router.get("/media-staging-jobs", response_model=MediaStagingJobListResponse)
def list_media_staging_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> MediaStagingJobListResponse:
    user = _current_user(db)
    jobs = list_media_staging_jobs_record(db, user_id=user.id, limit=limit)
    return MediaStagingJobListResponse(count=len(jobs), jobs=[_media_staging_job_out(item) for item in jobs])


@router.get("/media-staging-jobs/{job_id}", response_model=MediaStagingEnvelope)
def get_media_staging_job(
    job_id: str,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> MediaStagingEnvelope:
    user = _current_user(db)
    job = _require_media_staging_job(db, user_id=user.id, job_id=job_id)
    return MediaStagingEnvelope(job=_media_staging_job_out(job))


@router.post("/media-staging-jobs/{job_id}/finalize", response_model=MediaFinalizeEnvelope)
def finalize_media_staging_job(
    job_id: str,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> MediaFinalizeEnvelope:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
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

    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> VideoJobListResponse:
    user = _current_user(db)
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
def get_video_job(job_id: str, _admin_session=Depends(require_admin_session), db: Session = Depends(get_db)) -> VideoJobEnvelope:
    user = _current_user(db)
    job = _require_video_job(db, user_id=user.id, job_id=job_id)
    return VideoJobEnvelope(job=_video_job_out(job))


@router.put("/video-jobs/{job_id}/review", response_model=VideoJobReviewOut)
def put_video_job_review(
    job_id: str,
    payload: VideoJobReviewIn,
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> VideoJobReviewOut:
    user = _current_user(db)
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
    _admin_session=Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> Response:
    media_type = _VIDEO_JOB_ARTIFACT_MEDIA_TYPES.get(artifact_name)
    if media_type is None:
        raise HTTPException(status_code=404, detail="Fant ikke videoartefakt")

    user = _current_user(db)
    _require_video_job(db, user_id=user.id, job_id=job_id)
    target = _video_job_artifact_path(job_id, artifact_name)
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="Fant ikke videoartefakt")

    return FileResponse(target, media_type=media_type)


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
