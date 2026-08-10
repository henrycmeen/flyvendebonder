from __future__ import annotations

from datetime import date, datetime
from pathlib import PurePosixPath
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    phone: str | None = None
    email: str | None = None
    address_line1: str | None = None
    postal_code: str | None = None
    city: str | None = None
    municipality_code: str | None = None
    municipality_name: str | None = None
    created_at: datetime
    updated_at: datetime


class PropertyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    komm: str
    gnr: int
    bnr: int
    fnr: int
    label: str | None = None
    active_from: date | None = None
    active_to: date | None = None
    operating_relation: Literal["owned", "leased", "unknown"] = "unknown"
    operating_relation_source: str | None = None
    operating_relation_confirmed_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ProfileOut(BaseModel):
    user: UserOut
    property: PropertyOut | None = None
    additional_properties: list[PropertyOut] = Field(default_factory=list)


class ProfilePatch(BaseModel):
    full_name: str | None = None
    phone: str | None = None
    email: str | None = None
    address_line1: str | None = None
    postal_code: str | None = None
    city: str | None = None
    municipality_code: str | None = None
    municipality_name: str | None = None


class PropertyPatch(BaseModel):
    komm: str | None = None
    gnr: int | None = None
    bnr: int | None = None
    fnr: int | None = None
    label: str | None = None


class AdditionalPropertyPatch(PropertyPatch):
    id: int | None = None


class ProfilePatchRequest(BaseModel):
    user: ProfilePatch = Field(default_factory=ProfilePatch)
    property: PropertyPatch = Field(default_factory=PropertyPatch)
    additional_properties: list[AdditionalPropertyPatch] | None = None


class AdminLoginRequest(BaseModel):
    code: str = Field(default="", max_length=256)


class AdminSessionStatusResponse(BaseModel):
    configured: bool
    open_access: bool
    authenticated: bool
    expires_at: datetime | None = None


class TimelineDateEntry(BaseModel):
    date: date
    count: int
    cumulative_count: int


class TimelineResponse(BaseModel):
    user_id: int
    dates: list[TimelineDateEntry]


class PhotoAnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    ar5_class: str | None = None
    soil_class: str | None = None
    geometry_method: str | None = None
    confidence: float | None = None
    approved: bool | None = None
    computed_at: datetime | None = None


class PhotoAnalysisActionResponse(BaseModel):
    status: str
    photo_id: str
    analysis: PhotoAnalysisOut


class RgbTripletOut(BaseModel):
    r: float
    g: float
    b: float


class OrthophotoVegetationIndicesOut(BaseModel):
    exg: float
    vari: float
    ngrdi: float
    gli: float
    ndyi: float


class OrthophotoColorAnalysisOut(BaseModel):
    requested_size_px: int
    sampled_width_px: int
    sampled_height_px: int
    requested_pixels: int
    sampled_pixels: int
    valid_pixels: int
    clipped: bool
    mean_rgb: RgbTripletOut
    median_rgb: RgbTripletOut
    brightness: float
    light_assessment: str
    indices: OrthophotoVegetationIndicesOut
    quality_flags: list[str] = Field(default_factory=list)


class OrthophotoSampleOverlayOut(BaseModel):
    id: str
    label: str
    captured_date: str | None = None
    property_reference: str | None = None


class OrthophotoSampleSourceOut(BaseModel):
    kind: Literal["canonical", "preview"]
    path_basename: str
    width_px: int
    height_px: int
    canonical_width_px: int
    canonical_height_px: int
    gsd_m_per_px: dict[str, float] | None = None


class OrthophotoImagePixelOut(BaseModel):
    x: float
    y: float
    ratio_x: float
    ratio_y: float


class OrthophotoSamplePointOut(BaseModel):
    lat: float
    lng: float


class OrthophotoColorSampleResponse(BaseModel):
    overlay: OrthophotoSampleOverlayOut
    source: OrthophotoSampleSourceOut
    point: OrthophotoSamplePointOut
    image_pixel: OrthophotoImagePixelOut
    analysis: OrthophotoColorAnalysisOut


class PhotoMetadataPatchRequest(BaseModel):
    tags: list[str] | None = None
    caption: str | None = None
    needs_manual_qc: bool | None = None
    altitude_m: float | None = None
    heading_deg: float | None = None
    pitch_deg: float | None = None
    manual_view_lat: float | None = None
    manual_view_lng: float | None = None


class PhotoMetadataActionResponse(BaseModel):
    status: str
    photo_id: str
    tags: list[str]
    user_tags: list[str] = Field(default_factory=list)
    system_tags: list[str] = Field(default_factory=list)
    caption: str | None = None
    needs_manual_qc: bool = False
    altitude_m: float | None = None
    heading_deg: float | None = None
    pitch_deg: float | None = None
    manual_view_lat: float | None = None
    manual_view_lng: float | None = None


class GeoPoint(BaseModel):
    lat: float
    lng: float


class NoGoBuffer(BaseModel):
    id: str | None = None
    name: str | None = None
    center: GeoPoint
    width_m: float = Field(default=30, gt=0, le=500)
    height_m: float = Field(default=30, gt=0, le=500)
    radius_m: float | None = Field(default=None, gt=0, le=500)


class GeoJSONPoint(BaseModel):
    type: str
    coordinates: list[float]


class GeoJSONLineString(BaseModel):
    type: Literal["LineString"]
    coordinates: list[list[float]]


class GeoJSONPolygon(BaseModel):
    type: str
    coordinates: list[list[list[float]]]


FieldPlotStatus = Literal["draft", "confirmed"]
FieldPlotSource = Literal["manual", "suggested", "imported"]


class FieldPlotCreate(BaseModel):
    property_id: int | None = None
    name: str | None = None
    source: FieldPlotSource = "manual"
    status: FieldPlotStatus = "draft"
    geometry: GeoJSONPolygon
    source_provenance: dict[str, Any] = Field(default_factory=dict)


class FieldPlotPatch(BaseModel):
    name: str | None = None
    source: FieldPlotSource | None = None
    status: FieldPlotStatus | None = None
    geometry: GeoJSONPolygon | None = None
    source_provenance: dict[str, Any] | None = None


class FieldPlotOut(BaseModel):
    id: int
    property_id: int
    name: str | None = None
    source: FieldPlotSource
    status: FieldPlotStatus
    geometry: GeoJSONPolygon
    area_m2: float | None = None
    area_ha: float | None = None
    source_provenance: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class FieldPlotListResponse(BaseModel):
    property_id: int
    count: int
    fields: list[FieldPlotOut]


class FieldPlotDeleteResponse(BaseModel):
    status: Literal["deleted"]
    field_id: int


FieldHistoryEntryKind = Literal["mission", "capture", "processing_run"]
PlanningUnitStatus = Literal["active", "archived"]
FlightMissionDurationStatus = Literal["ok", "warning", "over_limit"]


class FieldHistoryEntryOut(BaseModel):
    kind: FieldHistoryEntryKind
    occurred_at: datetime
    season: str
    title: str
    status: str
    summary: str
    mission_id: int | None = None
    capture_id: int | None = None
    processing_run_id: int | None = None
    source: str | None = None
    provider: str | None = None
    photo_count: int | None = None
    artifact_count: int = 0
    artifact_kinds: list[str] = Field(default_factory=list)


class FieldHistoryOut(BaseModel):
    field: FieldPlotOut
    mission_count: int = 0
    capture_count: int = 0
    processing_run_count: int = 0
    delivery_count: int = 0
    entries: list[FieldHistoryEntryOut] = Field(default_factory=list)


class PlanningUnitOut(BaseModel):
    id: int
    property_id: int
    source_field_plot_id: int
    parent_unit_id: int | None = None
    name: str
    status: PlanningUnitStatus
    geometry: GeoJSONPolygon
    area_m2: float | None = None
    area_ha: float | None = None
    source_field_name: str
    source_field_source: FieldPlotSource = "manual"
    source_field_status: FieldPlotStatus
    source_field_provenance: dict[str, Any] = Field(default_factory=dict)
    is_split: bool = False
    latest_mission_id: int | None = None
    latest_mission_name: str | None = None
    latest_duration_status: FlightMissionDurationStatus | None = None
    latest_estimated_duration_s: float | None = None
    created_at: datetime
    updated_at: datetime


class PlanningUnitListResponse(BaseModel):
    property_id: int
    count: int
    units: list[PlanningUnitOut]


class PlanningUnitSyncResponse(PlanningUnitListResponse):
    created_count: int = 0


class PlanningUnitSplitIn(BaseModel):
    line: GeoJSONLineString


class PlanningUnitSplitOut(BaseModel):
    archived_unit: PlanningUnitOut
    created_units: list[PlanningUnitOut]


class PlanningPointResolveIn(BaseModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    radius_m: int | None = Field(default=None, ge=1, le=3000)


class PlanningPointResolveOut(BaseModel):
    property_id: int
    property_label: str | None = None
    unit: PlanningUnitOut
    imported_field: bool = False
    created_unit: bool = False
    property_created: bool = False
    candidate_name: str | None = None
    matrikkelnummer: str | None = None
    distance_m: int | None = None


OperatingRelation = Literal["owned", "leased", "unknown"]


class OperatingAreaPointIn(BaseModel):
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    radius_m: int | None = Field(default=None, ge=1, le=3000)


class OperatingAreaConfirmIn(OperatingAreaPointIn):
    operating_relation: OperatingRelation


class OperatingAreaPropertyRefOut(BaseModel):
    komm: str
    gnr: int
    bnr: int
    fnr: int = 0
    label: str | None = None


class OperatingAreaExistingOut(BaseModel):
    property_id: int
    field_id: int | None = None
    planning_unit_ids: list[int] = Field(default_factory=list)
    operating_relation: OperatingRelation


class OperatingAreaCandidateOut(BaseModel):
    candidate_id: str
    source: str
    source_endpoint: str | None = None
    source_fetched_at: datetime | None = None
    source_updated_at: datetime | None = None
    name: str | None = None
    matrikkelnummer: str | None = None
    property_ref: OperatingAreaPropertyRefOut
    local_id: int | str | None = None
    object_type: str | None = None
    accuracy_class: str | None = None
    distance_m: int | None = None
    geometry: GeoJSONPolygon
    area_m2: float | None = None
    area_ha: float | None = None
    existing: OperatingAreaExistingOut | None = None


class OperatingAreaPreviewOut(BaseModel):
    count: int
    candidates: list[OperatingAreaCandidateOut]
    owner_information_available: bool = False
    owner_information_message: str


class OperatingAreaConfirmOut(BaseModel):
    property: PropertyOut
    field: FieldPlotOut
    planning_units: list[PlanningUnitOut]
    property_created: bool = False
    field_created: bool = False
    planning_units_created: int = 0


ScoutingTaskStatus = Literal["open", "in_progress", "done"]
ScoutingTaskPriority = Literal["low", "normal", "high"]


def _validate_offset_aware_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    offset = value.utcoffset() if value.tzinfo is not None else None
    if offset is None:
        raise ValueError("Observasjonstidspunkt må inneholde tidssone-offset")
    if offset.total_seconds() % 60 != 0:
        raise ValueError("Observasjonstidspunktets offset må oppgis i hele minutter")
    return value


class ScoutingTaskCreate(BaseModel):
    property_id: int | None = None
    field_id: int = Field(gt=0)
    planning_unit_id: int | None = Field(default=None, ge=1)
    title: str = Field(min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000)
    status: ScoutingTaskStatus = "open"
    priority: ScoutingTaskPriority = "normal"
    observed_at: datetime | None = None
    position: GeoPoint
    photo_ids: list[str] = Field(default_factory=list)

    @field_validator("title")
    @classmethod
    def _normalize_title(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tittel kan ikke være tom")
        return normalized

    @field_validator("notes")
    @classmethod
    def _normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("observed_at")
    @classmethod
    def _validate_observed_at(cls, value: datetime | None) -> datetime | None:
        return _validate_offset_aware_datetime(value)

    @field_validator("photo_ids")
    @classmethod
    def _normalize_photo_ids(cls, value: list[str]) -> list[str]:
        normalized: list[str] = []
        for raw_id in value:
            photo_id = str(raw_id).strip()
            if photo_id and photo_id not in normalized:
                normalized.append(photo_id)
        if len(normalized) > 50:
            raise ValueError("Maks 50 bilder kan knyttes til et feltfunn")
        return normalized


class ScoutingTaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    notes: str | None = Field(default=None, max_length=4000)
    status: ScoutingTaskStatus | None = None
    priority: ScoutingTaskPriority | None = None
    observed_at: datetime | None = None
    position: GeoPoint | None = None
    photo_ids: list[str] | None = None

    @field_validator("title")
    @classmethod
    def _normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            raise ValueError("Tittel kan ikke være tom")
        return normalized

    @field_validator("notes")
    @classmethod
    def _normalize_notes(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("observed_at")
    @classmethod
    def _validate_observed_at(cls, value: datetime | None) -> datetime | None:
        return _validate_offset_aware_datetime(value)

    @field_validator("photo_ids")
    @classmethod
    def _normalize_photo_ids(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        normalized: list[str] = []
        for raw_id in value:
            photo_id = str(raw_id).strip()
            if photo_id and photo_id not in normalized:
                normalized.append(photo_id)
        if len(normalized) > 50:
            raise ValueError("Maks 50 bilder kan knyttes til et feltfunn")
        return normalized


class ScoutingTaskOut(BaseModel):
    id: int
    property_id: int
    field_id: int
    planning_unit_id: int | None = None
    title: str
    notes: str | None = None
    status: ScoutingTaskStatus
    priority: ScoutingTaskPriority
    observed_at: datetime | None = None
    observed_at_original_offset: str | None = None
    position: GeoPoint
    photo_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class ScoutingTaskListResponse(BaseModel):
    property_id: int | None = None
    count: int
    tasks: list[ScoutingTaskOut]


class FieldReportContractOut(BaseModel):
    name: Literal["flyvendebonder.field-report"] = "flyvendebonder.field-report"
    version: Literal["v1"] = "v1"


class FieldReportSummaryOut(BaseModel):
    mission_count: int = 0
    capture_count: int = 0
    processing_run_count: int = 0
    delivery_count: int = 0
    finding_count: int = 0
    open_finding_count: int = 0
    key_photo_count: int = 0
    artifact_kinds: list[str] = Field(default_factory=list)


class FieldReportPhotoOut(BaseModel):
    id: str
    thumbnail_url: str
    web_url: str


class FieldReportPropertyOut(BaseModel):
    id: int
    label: str | None = None
    komm: str
    gnr: int
    bnr: int
    fnr: int


class FieldReportOut(BaseModel):
    contract: FieldReportContractOut = Field(default_factory=FieldReportContractOut)
    title: str
    generated_at: datetime
    property: FieldReportPropertyOut
    field: FieldPlotOut
    summary: FieldReportSummaryOut
    findings: list[ScoutingTaskOut] = Field(default_factory=list)
    key_photos: list[FieldReportPhotoOut] = Field(default_factory=list)
    history: list[FieldHistoryEntryOut] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class CameraPresetOut(BaseModel):
    id: str
    name: str
    sensor_width_mm: float
    sensor_height_mm: float
    focal_length_mm: float
    image_width_px: int
    image_height_px: int


class DroneProfileOut(BaseModel):
    id: str
    name: str
    cruise_speed_mps: float
    capture_interval_s: float = 2.0
    max_mapping_speed_mps: float
    launch_overhead_s: int
    waypoint_turn_overhead_s: int
    max_flight_time_s: int
    reserve_percent: float
    default_ground_offset_m: float = 0.0
    default_camera_preset_id: str | None = None
    camera_presets: list[CameraPresetOut] = Field(default_factory=list)
    ground_footprint_width_ratio: float
    ground_footprint_height_ratio: float
    target_side_overlap: float
    target_front_overlap: float


class DroneProfileListResponse(BaseModel):
    count: int
    profiles: list[DroneProfileOut]


FlightMissionStatus = Literal["ready"]
FlightMissionWarningSeverity = Literal["info", "warning"]
FlightMissionTerrainMode = Literal["flat", "dem_agl"]


class FlightMissionParameters(BaseModel):
    altitude_m: float = Field(default=45.0, gt=0, le=500)
    line_spacing_m: float = Field(default=18.0, gt=0, le=200)
    waypoint_spacing_m: float = Field(default=18.0, gt=0, le=200)
    route_angle_deg: float = Field(default=0.0, ge=0, le=180)
    terrain_mode: FlightMissionTerrainMode = "flat"
    camera_preset_id: str | None = None
    ground_offset_m: float = Field(default=0.0, ge=0, le=200)
    launch_point: GeoPoint | None = None
    landing_point: GeoPoint | None = None
    no_go_buffers: list[NoGoBuffer] = Field(default_factory=list)


class FlightMissionCreate(BaseModel):
    property_id: int | None = None
    name: str | None = None
    field_ids: list[int] = Field(default_factory=list)
    planning_unit_ids: list[int] = Field(default_factory=list)
    drone_profile_id: str | None = None
    parameters: FlightMissionParameters = Field(default_factory=FlightMissionParameters)

    @model_validator(mode="after")
    def _validate_field_or_planning_units(self) -> "FlightMissionCreate":
        if not self.field_ids and not self.planning_unit_ids:
            raise ValueError("Oppdrag må inneholde minst ett jord eller én planenhet")
        return self


class FlightMissionPatch(BaseModel):
    property_id: int | None = None
    name: str | None = None
    field_ids: list[int] | None = None
    planning_unit_ids: list[int] | None = None
    drone_profile_id: str | None = None
    parameters: FlightMissionParameters | None = None


class FlightMissionWarningOut(BaseModel):
    code: str
    severity: FlightMissionWarningSeverity
    message: str
    field_id: int | None = None


class FlightMissionFieldOut(BaseModel):
    field_id: int
    planning_unit_id: int | None = None
    name: str
    source: FieldPlotSource | None = None
    source_provenance: dict[str, Any] = Field(default_factory=dict)
    area_m2: float | None = None
    area_ha: float | None = None
    geometry: GeoJSONPolygon


class GeoJSONFeatureCollection(BaseModel):
    type: Literal["FeatureCollection"]
    features: list[dict]


class FlightMissionOut(BaseModel):
    id: int
    property_id: int
    name: str
    status: FlightMissionStatus
    field_ids: list[int]
    planning_unit_ids: list[int] = Field(default_factory=list)
    drone_profile_id: str | None = None
    drone_profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    estimated_duration_s: float | None = None
    duration_status: FlightMissionDurationStatus | None = None
    parameters: FlightMissionParameters
    fields: list[FlightMissionFieldOut]
    warnings: list[FlightMissionWarningOut]
    route_geojson: GeoJSONFeatureCollection
    export_manifest: dict
    created_at: datetime
    updated_at: datetime
    last_generated_at: datetime


class FlightMissionListResponse(BaseModel):
    property_id: int
    count: int
    missions: list[FlightMissionOut]


class FlightMissionPreviewOut(BaseModel):
    name: str
    status: FlightMissionStatus
    field_ids: list[int]
    planning_unit_ids: list[int] = Field(default_factory=list)
    drone_profile_id: str | None = None
    drone_profile_snapshot: dict[str, Any] = Field(default_factory=dict)
    estimated_duration_s: float | None = None
    duration_status: FlightMissionDurationStatus | None = None
    parameters: FlightMissionParameters
    fields: list[FlightMissionFieldOut]
    warnings: list[FlightMissionWarningOut]
    route_geojson: GeoJSONFeatureCollection
    export_manifest: dict


FlightCaptureStatus = Literal["ready", "archived"]
FlightCaptureSource = Literal["manual", "mission", "imported"]
ProcessingProvider = Literal["webodm", "odm_cli"]
ProcessingRunStatus = Literal["queued", "running", "completed", "failed", "cancelled"]
ProcessingArtifactKind = Literal["ortho", "dsm", "dtm", "point_cloud", "thumb", "tiles", "mesh", "qa_report"]
ProcessingArtifactFormat = Literal["cog", "geotiff", "pmtiles", "jpg", "png", "webp", "laz", "las", "obj", "json", "pdf"]


class FlightCaptureCreate(BaseModel):
    name: str | None = None
    mission_id: int | None = None
    source: FlightCaptureSource = "manual"
    photo_ids: list[str] = Field(min_length=1)
    notes: str | None = None


class FlightCaptureOut(BaseModel):
    id: int
    user_id: int
    property_id: int
    mission_id: int | None = None
    name: str | None = None
    source: FlightCaptureSource
    status: FlightCaptureStatus
    photo_ids: list[str]
    photo_count: int
    field_ids: list[int] = Field(default_factory=list)
    captured_from: datetime | None = None
    captured_to: datetime | None = None
    first_photo_id: str | None = None
    last_photo_id: str | None = None
    is_contiguous: bool = True
    notes: str | None = None
    processing_run_count: int = 0
    created_at: datetime
    updated_at: datetime


class FlightCaptureListResponse(BaseModel):
    property_id: int
    count: int
    captures: list[FlightCaptureOut]


class ProcessingRunCreate(BaseModel):
    capture_id: int
    provider: ProcessingProvider = "webodm"
    requested_outputs: list[str] = Field(default_factory=list)
    provider_config: dict = Field(default_factory=dict)

    @field_validator("provider")
    @classmethod
    def _validate_provider(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("provider kan ikke være tom")
        return normalized


class ProcessingRunPatch(BaseModel):
    status: ProcessingRunStatus | None = None
    external_job_id: str | None = None
    error_detail: str | None = None
    provider_config: dict | None = None


class ProcessingRunOut(BaseModel):
    id: int
    capture_id: int
    provider: str
    status: ProcessingRunStatus
    external_job_id: str | None = None
    requested_outputs: list[str] = Field(default_factory=list)
    provider_config: dict = Field(default_factory=dict)
    input_manifest: dict = Field(default_factory=dict)
    error_detail: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    last_synced_at: datetime | None = None
    artifact_count: int = 0
    created_at: datetime
    updated_at: datetime


class ProcessingRunListResponse(BaseModel):
    property_id: int
    count: int
    runs: list[ProcessingRunOut]


class ProcessingArtifactCreate(BaseModel):
    kind: ProcessingArtifactKind
    format: ProcessingArtifactFormat
    uri: str = Field(min_length=1, max_length=1024)
    source_ref: str | None = Field(default=None, max_length=2048)
    ingest_run_id: int | None = Field(default=None, ge=1)
    bytes: int | None = Field(default=None, ge=0)
    checksum: str | None = Field(default=None, max_length=128)
    is_public: bool = False
    metadata: dict = Field(default_factory=dict)
    provenance: dict = Field(default_factory=dict)

    @field_validator("kind", "format", "uri")
    @classmethod
    def _validate_required_strings(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("feltet kan ikke være tomt")
        return normalized

    @field_validator("source_ref")
    @classmethod
    def _validate_source_ref(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @field_validator("checksum")
    @classmethod
    def _validate_checksum(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class ProcessingArtifactOut(BaseModel):
    id: int
    processing_run_id: int
    ingest_run_id: int | None = None
    kind: str
    format: str
    uri: str
    source_ref: str | None = None
    bytes: int | None = None
    checksum: str | None = None
    is_public: bool = False
    metadata: dict = Field(default_factory=dict)
    provenance: dict = Field(default_factory=dict)
    public_url: str | None = None
    created_at: datetime
    updated_at: datetime


class ProcessingArtifactListResponse(BaseModel):
    processing_run_id: int
    count: int
    artifacts: list[ProcessingArtifactOut]


class PhotoAssetOut(BaseModel):
    id: int
    photo_id: str
    ingest_run_id: int | None = None
    kind: str
    path: str
    mime: str
    bytes: int
    width: int | None = None
    height: int | None = None
    checksum: str | None = None
    source_ref: str | None = None
    provenance: dict = Field(default_factory=dict)
    asset_url: str | None = None


class PhotoAssetListResponse(BaseModel):
    photo_id: str
    count: int
    assets: list[PhotoAssetOut]


class StacLink(BaseModel):
    model_config = ConfigDict(extra="allow")

    rel: str
    href: str
    type: str | None = None
    title: str | None = None


class StacAsset(BaseModel):
    model_config = ConfigDict(extra="allow")

    href: str | None = None
    type: str | None = None
    title: str | None = None
    description: str | None = None
    roles: list[str] = Field(default_factory=list)


class StacCollectionOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["Collection"]
    stac_version: str
    stac_extensions: list[str] = Field(default_factory=list)
    id: str
    title: str
    description: str
    license: str
    extent: dict
    links: list[StacLink] = Field(default_factory=list)
    item_assets: dict[str, StacAsset] = Field(default_factory=dict)


class StacCollectionListResponse(BaseModel):
    collections: list[StacCollectionOut] = Field(default_factory=list)
    links: list[StacLink] = Field(default_factory=list)


class StacItemOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["Feature"]
    stac_version: str
    stac_extensions: list[str] = Field(default_factory=list)
    id: str
    collection: str
    geometry: dict
    bbox: list[float]
    properties: dict
    links: list[StacLink] = Field(default_factory=list)
    assets: dict[str, StacAsset] = Field(default_factory=dict)


class StacItemCollectionOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: Literal["FeatureCollection"]
    features: list[StacItemOut] = Field(default_factory=list)
    links: list[StacLink] = Field(default_factory=list)


FieldCandidateSource = Literal["geonorge"]


class FieldCandidateOut(BaseModel):
    source: FieldCandidateSource
    source_endpoint: str | None = None
    source_fetched_at: datetime | None = None
    name: str
    local_id: int | None = None
    matrikkelnummer: str | None = None
    object_type: str | None = None
    accuracy_class: str | None = None
    is_main_area: bool = False
    distance_m: int | None = None
    geometry: GeoJSONPolygon
    area_m2: float | None = None
    area_ha: float | None = None
    source_updated_at: datetime | None = None
    ar5_class: str | None = None
    land_use_kind: str = "unknown"
    land_use_label: str = "Uavklart"


class FieldCandidateListResponse(BaseModel):
    property_id: int
    count: int
    fields: list[FieldCandidateOut]


class SamplingStrategy(BaseModel):
    type: str
    radius_m: float


class CoverageProfile(BaseModel):
    planned_front: float | None = None
    planned_side: float | None = None
    actual_front: float | None = None
    actual_side: float | None = None
    front_gap: float | None = None
    side_gap: float | None = None
    neighbor_count: int | None = None
    quality: str = "ok"


class AnalysisZone(BaseModel):
    center_point: GeoPoint
    sample_points: list[GeoPoint]
    footprint_polygon: GeoJSONPolygon | None = None
    sampling_strategy: SamplingStrategy
    uncertainty_radius_m: float
    analysis_area_m: float | None = None


class PhotoFeature(BaseModel):
    id: str
    property_id: int | None = None
    title: str
    captured_at: datetime
    captured_date: date
    lat: float
    lng: float
    altitude_m: float | None = None
    heading_deg: float | None = None
    pitch_deg: float | None = None
    gsd_m: float | None = None
    image_footprint_w_m: float | None = None
    track_spacing_m: float | None = None
    overlap_front: float | None = None
    overlap_side: float | None = None
    oblique_correction_applied: bool | None = None
    view_lat: float | None = None
    view_lng: float | None = None
    view_distance_m: float | None = None
    view_confidence: float | None = None
    view_mode: str | None = None
    heading_source: str | None = None
    pitch_source: str | None = None
    ingest_run_id: int | None = None
    source_checksum: str | None = None
    source_ref: str | None = None
    confidence_score: float = 0.0
    confidence_reasons: list[str] = Field(default_factory=list)
    location_uncertainty_m: float | None = None
    coverage_profile: CoverageProfile | None = None
    analysis_zone: AnalysisZone | None = None
    tags: list[str]
    user_tags: list[str] = Field(default_factory=list)
    system_tags: list[str] = Field(default_factory=list)
    caption: str | None = None
    thumbnail_url: str | None = None
    image_url: str | None = None
    needs_manual_qc: bool = False
    quality_flags: list[str] = Field(default_factory=list)
    analysis: PhotoAnalysisOut | None = None


class PhotoResponse(BaseModel):
    user_id: int
    date: date
    mode: Literal["day", "cumulative"]
    count: int
    photos: list[PhotoFeature]


class PhotoPageResponse(BaseModel):
    user_id: int
    date: date
    mode: Literal["day", "cumulative"]
    count: int
    next_cursor: str | None = None
    photos: list[PhotoFeature]


class GardskartJobResponse(BaseModel):
    property_id: int
    job_id: str | None = None
    status_code: int | None = None
    status_desc: str | None = None
    fetched_at: datetime | None = None
    expires_at: datetime | None = None
    source: Literal["cache", "fresh", "stale-cache", "disabled"]
    is_expired: bool


class SourceLayerStatus(BaseModel):
    enabled: bool
    configured: bool
    source: Literal["enabled", "disabled"]
    status_desc: str


class SourceStatusResponse(BaseModel):
    ar5: SourceLayerStatus
    gardskart: SourceLayerStatus
    soil: SourceLayerStatus


class ImportRunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    started_at: datetime
    finished_at: datetime | None = None
    source_path: str
    files_seen: int
    files_imported: int
    files_skipped: int
    errors_json: str


class ImportRequest(BaseModel):
    source_path: str | None = None
    include_files: list[str] | None = Field(default=None, max_length=10_000)

    @field_validator("include_files")
    @classmethod
    def validate_include_files(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None

        normalized: list[str] = []
        seen: set[str] = set()
        for value in values:
            if value != value.strip():
                raise ValueError("include_files kan ikke ha innledende eller etterfølgende mellomrom")
            candidate = PurePosixPath(value)
            if not value or candidate.is_absolute() or ".." in candidate.parts:
                raise ValueError("include_files må inneholde relative filstier under source_path")
            if candidate.suffix.lower() not in {".jpg", ".jpeg", ".tif", ".tiff"}:
                raise ValueError("include_files kan bare inneholde støttede bildefiler")

            relative_path = candidate.as_posix()
            if relative_path in seen:
                raise ValueError("include_files kan ikke inneholde duplikater")
            seen.add(relative_path)
            normalized.append(relative_path)

        return normalized


MediaStagingJobStatus = Literal["staged", "finalized", "failed"]
MediaStagingItemStatus = Literal["staged", "rejected"]
MediaStagingKind = Literal["image", "video", "unknown"]


class MediaStagingItemOut(BaseModel):
    id: int
    filename: str
    mime: str | None = None
    bytes: int
    checksum: str | None = None
    media_kind: MediaStagingKind
    status: MediaStagingItemStatus
    error_detail: str | None = None


class MediaStagingCountsOut(BaseModel):
    total: int
    image_count: int
    video_count: int
    unknown_count: int
    rejected_count: int


class MediaStagingJobOut(BaseModel):
    job_id: str
    source: str
    status: MediaStagingJobStatus
    counts: MediaStagingCountsOut
    items: list[MediaStagingItemOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class MediaStagingEnvelope(BaseModel):
    job: MediaStagingJobOut


class MediaStagingJobListResponse(BaseModel):
    count: int
    jobs: list[MediaStagingJobOut]


MediaFinalizeItemStatus = Literal["imported", "skipped", "created", "reused", "rejected", "failed"]


class MediaFinalizeItemOut(BaseModel):
    staging_item_id: int
    filename: str
    media_kind: MediaStagingKind
    status: MediaFinalizeItemStatus
    photo_id: str | None = None
    video_job_id: str | None = None
    detail: str | None = None


class MediaFinalizeResultOut(BaseModel):
    job_id: str
    status: MediaStagingJobStatus
    import_run_id: int | None = None
    image_imported_count: int = 0
    image_skipped_count: int = 0
    video_jobs_created: int = 0
    video_jobs_reused: int = 0
    rejected_count: int = 0
    items: list[MediaFinalizeItemOut] = Field(default_factory=list)


class MediaFinalizeEnvelope(BaseModel):
    result: MediaFinalizeResultOut


class BackendLogLine(BaseModel):
    timestamp: str
    level: str
    logger: str
    request_id: str | None = None
    message: str
    raw: str


class BackendLogsResponse(BaseModel):
    source: str
    count: int
    generated_at: datetime
    lines: list[BackendLogLine]


class PhotoAnalysisRefreshResponse(BaseModel):
    requested: int
    processed: int
    failed: int


class PhotoReprocessResponse(BaseModel):
    requested: int
    metadata_updated: int
    analysis_processed: int
    analysis_failed: int
    missing_original: int
    parse_failed: int


VideoJobMode = Literal["frames", "map3d"]
VideoJobStatus = Literal["pending", "processing", "done", "failed"]
VideoJobReviewState = Literal["placed", "kept", "discarded"]


class VideoJobPlacement(BaseModel):
    lat: float
    lng: float


class VideoFrameResultOut(BaseModel):
    index: int
    timestamp_ms: int
    image_url: str


class VideoFramesResultOut(BaseModel):
    frame_count: int
    fps: int
    selected_frame_count: int
    route_distance_m: float | None = None
    step_distance_m: float | None = None
    sample_frames: list[VideoFrameResultOut] = Field(default_factory=list)
    archive_url: str | None = None


class VideoRouteArtifactOut(BaseModel):
    stitch_job_id: str | None = None
    preview_image: str | None = None
    mesh_url: str | None = None
    geodata_geojson: str | None = None
    metadata_json: str | None = None
    epsg: str | None = None


class VideoJobReviewIn(BaseModel):
    created_at: datetime | None = None
    mode: str | None = None
    review_state: VideoJobReviewState
    placement: VideoJobPlacement | None = None


class VideoJobReviewOut(BaseModel):
    job_id: str
    created_at: datetime | None = None
    mode: str | None = None
    review_state: VideoJobReviewState
    placement: VideoJobPlacement | None = None
    reviewed_at: datetime


class VideoJobOut(BaseModel):
    job_id: str
    filename: str
    mode: VideoJobMode
    status: VideoJobStatus
    created_at: datetime
    updated_at: datetime
    message: str | None = None
    config: dict[str, Any] = Field(default_factory=dict)
    result_frames: VideoFramesResultOut | None = None
    result_map3d: VideoRouteArtifactOut | None = None
    result: VideoFramesResultOut | dict[str, Any] | None = None
    review: VideoJobReviewOut | None = None


class VideoJobEnvelope(BaseModel):
    job: VideoJobOut


class VideoJobListResponse(BaseModel):
    count: int
    jobs: list[VideoJobOut]
