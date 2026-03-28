export type TimelineMode = "day" | "cumulative";

export interface ProfileUser {
  id: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  address_line1: string | null;
  postal_code: string | null;
  city: string | null;
  municipality_code: string | null;
  municipality_name: string | null;
}

export interface Property {
  id: number;
  user_id: number;
  komm: string;
  gnr: number;
  bnr: number;
  fnr: number;
  label: string | null;
}

export interface ProfileResponse {
  user: ProfileUser;
  property: Property | null;
  additional_properties: Property[];
}

export interface AdminSessionStatus {
  configured: boolean;
  authenticated: boolean;
  expires_at: string | null;
}

export interface TimelineDate {
  date: string;
  count: number;
  cumulative_count: number;
}

export interface TimelineResponse {
  user_id: number;
  dates: TimelineDate[];
}

export interface PhotoAnalysis {
  ar5_class: string | null;
  soil_class: string | null;
  geometry_method: string | null;
  confidence: number | null;
  approved: boolean | null;
  computed_at: string | null;
}

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface NoGoBuffer {
  id: string | null;
  name: string | null;
  center: GeoPoint;
  radius_m: number;
}

export interface SamplingStrategy {
  type: string;
  radius_m: number;
}

export interface GeoJSONPolygon {
  type: string;
  coordinates: number[][][];
}

export interface GeoJSONLineString {
  type: "LineString";
  coordinates: number[][];
}

export type FieldPlotStatus = "draft" | "confirmed";
export type FieldPlotSource = "manual" | "suggested" | "imported";

export interface FieldPlot {
  id: number;
  property_id: number;
  name: string | null;
  source: FieldPlotSource;
  status: FieldPlotStatus;
  geometry: GeoJSONPolygon;
  area_m2: number | null;
  area_ha: number | null;
  created_at: string;
  updated_at: string;
}

export interface FieldPlotDraft {
  id: number | null;
  property_id: number | null;
  name: string | null;
  source: FieldPlotSource;
  status: FieldPlotStatus;
  geometry: GeoJSONPolygon;
  area_m2: number | null;
  area_ha: number | null;
  isNew: boolean;
  isDirty: boolean;
}

export interface FieldPlotListResponse {
  property_id: number;
  count: number;
  fields: FieldPlot[];
}

export interface FieldPlotDeleteResponse {
  status: "deleted";
  field_id: number;
}

export type FlightMissionStatus = "ready";
export type FlightMissionWarningSeverity = "info" | "warning";
export type PlanningUnitStatus = "active" | "archived";
export type FlightMissionDurationStatus = "ok" | "warning" | "over_limit";

export interface FlightMissionParameters {
  altitude_m: number;
  line_spacing_m: number;
  waypoint_spacing_m: number;
  route_angle_deg: number;
  launch_point: GeoPoint | null;
  landing_point: GeoPoint | null;
  no_go_buffers: NoGoBuffer[];
}

export interface FlightMissionWarning {
  code: string;
  severity: FlightMissionWarningSeverity;
  message: string;
  field_id: number | null;
}

export interface FlightMissionField {
  field_id: number;
  planning_unit_id: number | null;
  name: string;
  area_m2: number | null;
  area_ha: number | null;
  geometry: GeoJSONPolygon;
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Record<string, unknown>[];
}

export interface FlightMission {
  id: number;
  property_id: number;
  name: string;
  status: FlightMissionStatus;
  field_ids: number[];
  planning_unit_ids: number[];
  drone_profile_id: string | null;
  drone_profile_snapshot: Record<string, unknown>;
  estimated_duration_s: number | null;
  duration_status: FlightMissionDurationStatus | null;
  parameters: FlightMissionParameters;
  fields: FlightMissionField[];
  warnings: FlightMissionWarning[];
  route_geojson: GeoJSONFeatureCollection;
  export_manifest: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_generated_at: string;
}

export interface FlightMissionListResponse {
  property_id: number;
  count: number;
  missions: FlightMission[];
}

export interface FlightMissionPreview {
  name: string;
  status: FlightMissionStatus;
  field_ids: number[];
  planning_unit_ids: number[];
  drone_profile_id: string | null;
  drone_profile_snapshot: Record<string, unknown>;
  estimated_duration_s: number | null;
  duration_status: FlightMissionDurationStatus | null;
  parameters: FlightMissionParameters;
  fields: FlightMissionField[];
  warnings: FlightMissionWarning[];
  route_geojson: GeoJSONFeatureCollection;
  export_manifest: Record<string, unknown>;
}

export interface PlanningUnit {
  id: number;
  property_id: number;
  source_field_plot_id: number;
  parent_unit_id: number | null;
  name: string;
  status: PlanningUnitStatus;
  geometry: GeoJSONPolygon;
  area_m2: number | null;
  area_ha: number | null;
  source_field_name: string;
  source_field_status: FieldPlotStatus;
  is_split: boolean;
  latest_mission_id: number | null;
  latest_mission_name: string | null;
  latest_duration_status: FlightMissionDurationStatus | null;
  latest_estimated_duration_s: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlanningUnitListResponse {
  property_id: number;
  count: number;
  units: PlanningUnit[];
}

export interface PlanningUnitSyncResponse extends PlanningUnitListResponse {
  created_count: number;
}

export interface PlanningUnitSplitResponse {
  archived_unit: PlanningUnit;
  created_units: PlanningUnit[];
}

export interface PlanningPointResolveResponse {
  property_id: number;
  property_label: string | null;
  unit: PlanningUnit;
  imported_field: boolean;
  created_unit: boolean;
  property_created: boolean;
  candidate_name: string | null;
  matrikkelnummer: string | null;
  distance_m: number | null;
}

export interface DroneProfile {
  id: string;
  name: string;
  cruise_speed_mps: number;
  launch_overhead_s: number;
  waypoint_turn_overhead_s: number;
  max_flight_time_s: number;
  reserve_percent: number;
  ground_footprint_width_ratio: number;
  ground_footprint_height_ratio: number;
  target_side_overlap: number;
  target_front_overlap: number;
}

export interface DroneProfileListResponse {
  count: number;
  profiles: DroneProfile[];
}

export type FieldCandidateSource = "geonorge";

export interface FieldCandidate {
  source: FieldCandidateSource;
  name: string;
  local_id: number | null;
  matrikkelnummer: string | null;
  object_type: string | null;
  accuracy_class: string | null;
  is_main_area: boolean;
  distance_m: number | null;
  geometry: GeoJSONPolygon;
  area_m2: number | null;
  area_ha: number | null;
  source_updated_at: string | null;
  ar5_class: string | null;
  land_use_kind: string;
  land_use_label: string;
}

export interface FieldCandidateListResponse {
  property_id: number;
  count: number;
  fields: FieldCandidate[];
}

export interface AnalysisZone {
  center_point: GeoPoint;
  sample_points: GeoPoint[];
  footprint_polygon: GeoJSONPolygon | null;
  sampling_strategy: SamplingStrategy;
  uncertainty_radius_m: number;
  analysis_area_m?: number;
}

export interface CoverageProfile {
  planned_front: number | null;
  planned_side: number | null;
  actual_front: number | null;
  actual_side: number | null;
  front_gap: number | null;
  side_gap: number | null;
  neighbor_count: number | null;
  quality: "ok" | "warn" | "unknown";
}

export interface PhotoAnalysisActionResponse {
  status: string;
  photo_id: string;
  analysis: PhotoAnalysis;
}

export interface PhotoMetadataActionResponse {
  status: string;
  photo_id: string;
  tags: string[];
  caption: string | null;
  needs_manual_qc: boolean;
  altitude_m: number | null;
  heading_deg: number | null;
  pitch_deg: number | null;
  manual_view_lat: number | null;
  manual_view_lng: number | null;
}

export interface PhotoFeature {
  id: string;
  title: string;
  captured_at: string;
  captured_date: string;
  lat: number;
  lng: number;
  altitude_m: number | null;
  heading_deg: number | null;
  pitch_deg: number | null;
  gsd_m: number | null;
  image_footprint_w_m: number | null;
  track_spacing_m: number | null;
  overlap_front: number | null;
  overlap_side: number | null;
  oblique_correction_applied: boolean | null;
  view_lat: number | null;
  view_lng: number | null;
  view_distance_m: number | null;
  view_mode: string | null;
  view_confidence: number | null;
  heading_source: string | null;
  pitch_source: string | null;
  confidence_score: number;
  confidence_reasons: string[];
  location_uncertainty_m: number | null;
  coverage_profile: CoverageProfile | null;
  analysis_zone: AnalysisZone | null;
  needs_manual_qc: boolean;
  quality_flags: string[];
  tags: string[];
  caption: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  analysis: PhotoAnalysis | null;
}

export interface PhotosResponse {
  user_id: number;
  date: string;
  mode: TimelineMode;
  count: number;
  photos: PhotoFeature[];
}

export interface PhotosPageResponse {
  user_id: number;
  date: string;
  mode: TimelineMode;
  count: number;
  next_cursor: string | null;
  photos: PhotoFeature[];
}

export interface GardskartJob {
  property_id: number;
  job_id: string;
  status_code: number | null;
  status_desc: string | null;
  fetched_at: string;
  expires_at: string;
  source: "cache" | "fresh" | "stale-cache";
  is_expired: boolean;
}

export interface VideoMap3dResultInfo {
  stitch_job_id: string | null;
  preview_image: string | null;
  mesh_url: string | null;
  geodata_geojson: string | null;
  metadata_json: string | null;
  epsg: string | null;
}

export interface VideoFrameResultInfo {
  index: number;
  timestamp_ms: number;
  image_url: string;
}

export interface VideoFramesResultInfo {
  frame_count: number;
  fps: number;
  selected_frame_count: number;
  route_distance_m: number | null;
  step_distance_m: number | null;
  sample_frames: VideoFrameResultInfo[];
  archive_url: string | null;
}

export type VideoMapArtifactReviewState = "placed" | "kept" | "discarded";

export interface VideoMapPlacement {
  lat: number;
  lng: number;
}

export interface VideoMapArtifact {
  jobId: string;
  createdAt: string;
  mode: string;
  reviewState: VideoMapArtifactReviewState;
  placement: VideoMapPlacement | null;
  map3dResult: VideoMap3dResultInfo | null;
}

export type VideoMapReviewDecision = "place_on_map" | "keep" | "discard";
export type VideoJobReviewState = "placed" | "kept" | "discarded";

export interface VideoMapReviewPayload {
  jobId: string;
  createdAt: string;
  mode: string;
  decision: VideoMapReviewDecision;
  placement: VideoMapPlacement | null;
  map3dResult: VideoMap3dResultInfo | null;
}

export interface VideoJobReview {
  job_id: string;
  created_at: string | null;
  mode: string | null;
  review_state: VideoJobReviewState;
  placement: VideoMapPlacement | null;
  reviewed_at: string;
}

export interface ImportRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  source_path: string;
  files_seen: number;
  files_imported: number;
  files_skipped: number;
  errors_json: string;
}
