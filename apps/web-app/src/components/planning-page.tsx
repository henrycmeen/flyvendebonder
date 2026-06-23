import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Camera, CheckCircle2, CircleOff, ClipboardList, Download, MapPin, MousePointer2, Pause, PencilLine, Plane, Play, Plus, RefreshCw, Scissors, Search, Settings2, TimerReset, Trash2 } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlanningMap } from "@/components/planning-map";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  CameraPreset,
  DroneProfile,
  DroneProfileListResponse,
  FieldCandidate,
  FieldCandidateListResponse,
  FieldPlotDeleteResponse,
  FieldPlot,
  FieldPlotSource,
  FieldSourceProvenance,
  FlightMission,
  FlightMissionParameters,
  FlightMissionPreview,
  FlightMissionTerrainMode,
  GeoJSONPolygon,
  GeoPoint,
  NoGoBuffer,
  PlanningUnit,
  PlanningUnitListResponse,
  PlanningPointResolveResponse,
  PlanningUnitSplitResponse,
  PlanningUnitSyncResponse,
  Property,
  ScoutingTask,
  ScoutingTaskListResponse,
  ScoutingTaskPriority,
  ScoutingTaskStatus,
} from "@/types";
import type { BaseMapStyle } from "@/lib/map-styles";

const DEFAULT_FLIGHT_MISSION_PARAMETERS: FlightMissionParameters = {
  altitude_m: 45,
  line_spacing_m: 18,
  waypoint_spacing_m: 18,
  route_angle_deg: 0,
  terrain_mode: "dem_agl",
  camera_preset_id: null,
  ground_offset_m: 0,
  launch_point: null,
  landing_point: null,
  no_go_buffers: [],
};

const RESOLVE_PRIMARY_RADIUS_M = 90;
const RESOLVE_FALLBACK_RADIUS_M = 180;

interface PlanningPageProps {
  properties: Property[];
  canEdit: boolean;
  missions: FlightMission[];
  activeMissionId: number | null;
  missionFocusToken: number;
  missionExportBusyId: number | null;
  missionDeleteBusyId: number | null;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  onSelectMission: (missionId: number | null) => void;
  onExportMission: (missionId: number) => void;
  onDeleteMission: (missionId: number) => void;
  onReloadMissions: () => Promise<unknown> | void;
  onReloadProfile: () => Promise<unknown> | void;
}

type PlanningToolMode = "select" | "resolve" | "edit" | "split" | "launch" | "landing" | "no_go";
type PlanningSuggestion = FieldCandidate & { property_id: number; property_label: string };
type SuggestionFilter = "all" | "field" | "forest" | "unknown";
type UnitBucket = "field" | "forest" | "unknown";
type PreviewSuggestion = {
  key: string;
  name: string;
  propertyLabel: string;
  geometry: GeoJSONPolygon;
};
type MissionCapturePoint = {
  sequence: number;
  lat: number;
  lng: number;
};
type ScoutingTaskDraft = {
  title: string;
  notes: string;
  lat: string;
  lng: string;
  priority: ScoutingTaskPriority;
};

interface HoverActionButtonProps extends ComponentProps<typeof Button> {
  help: string;
}

function HoverActionButton({ help, ...props }: HoverActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button aria-label={props["aria-label"] ?? help} title={props.title ?? help} {...props} />
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  );
}

function initialToolMode(canEdit: boolean, hasUnits = false): PlanningToolMode {
  if (!canEdit) return "select";
  return hasUnits ? "select" : "resolve";
}

function formatArea(areaHa: number | null): string {
  if (areaHa == null || !Number.isFinite(areaHa)) return "Ukjent areal";
  return areaHa >= 10 ? `${areaHa.toFixed(1)} ha` : `${areaHa.toFixed(2)} ha`;
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return "Ikke beregnet";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} t` : `${hours} t ${remaining} min`;
}

function scoutingStatusLabel(status: ScoutingTaskStatus): string {
  if (status === "done") return "Ferdig";
  if (status === "in_progress") return "Under arbeid";
  return "Åpen";
}

function scoutingPriorityLabel(priority: ScoutingTaskPriority): string {
  if (priority === "high") return "Høy";
  if (priority === "low") return "Lav";
  return "Normal";
}

function scoutingPriorityTone(priority: ScoutingTaskPriority): string {
  if (priority === "high") return "text-[color:var(--fb-accent-danger)]";
  if (priority === "low") return "text-fb-text-secondary";
  return "text-[color:var(--fb-season-solid)]";
}

function unitApproxCenter(unit: PlanningUnit | null): GeoPoint | null {
  const ring = unit?.geometry?.coordinates?.[0] ?? [];
  const points = ring
    .filter((point) => Array.isArray(point) && point.length >= 2)
    .map((point) => ({ lng: Number(point[0]), lat: Number(point[1]) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  if (points.length === 0) return null;
  const closed =
    points.length > 1 &&
    points[0].lat === points[points.length - 1].lat &&
    points[0].lng === points[points.length - 1].lng;
  const usable = closed ? points.slice(0, -1) : points;
  const total = usable.reduce(
    (acc, point) => ({
      lat: acc.lat + point.lat,
      lng: acc.lng + point.lng,
    }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: total.lat / usable.length,
    lng: total.lng / usable.length,
  };
}

function roundSpacing(value: number): number {
  return Math.max(1, Math.round(value * 10) / 10);
}

function formatMeters(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "Ukjent";
  return `${roundSpacing(value)} m`;
}

function getCameraPreset(profile: DroneProfile | null, cameraPresetId: string | null | undefined): CameraPreset | null {
  if (!profile || !Array.isArray(profile.camera_presets) || profile.camera_presets.length === 0) return null;
  const normalizedRequested = typeof cameraPresetId === "string" && cameraPresetId.trim() ? cameraPresetId.trim() : null;
  if (normalizedRequested) {
    const requested = profile.camera_presets.find((preset) => preset.id === normalizedRequested);
    if (requested) return requested;
  }
  if (profile.default_camera_preset_id) {
    const defaultPreset = profile.camera_presets.find((preset) => preset.id === profile.default_camera_preset_id);
    if (defaultPreset) return defaultPreset;
  }
  return profile.camera_presets[0] ?? null;
}

function suggestSpacing(
  profile: DroneProfile | null,
  altitudeM: number,
  cameraPresetId: string | null | undefined,
  groundOffsetM = 0,
): {
  line_spacing_m: number;
  waypoint_spacing_m: number;
  capture_interval_s?: number;
  recommended_ground_speed_mps?: number;
  max_mapping_speed_mps?: number;
  footprint_width_m?: number;
  footprint_height_m?: number;
  effective_altitude_m?: number;
  gsd_width_cm?: number;
  gsd_height_cm?: number;
} | null {
  if (!profile || !Number.isFinite(altitudeM) || altitudeM <= 0) return null;
  const effectiveAltitudeM = Math.max(1, altitudeM - Math.max(0, Number.isFinite(groundOffsetM) ? groundOffsetM : 0));
  const sideOverlap = Number(profile.target_side_overlap);
  const frontOverlap = Number(profile.target_front_overlap);
  if (!Number.isFinite(sideOverlap) || !Number.isFinite(frontOverlap)) {
    return null;
  }

  const cameraPreset = getCameraPreset(profile, cameraPresetId);
  if (cameraPreset) {
    const footprintWidthM = effectiveAltitudeM * (cameraPreset.sensor_width_mm / cameraPreset.focal_length_mm);
    const footprintHeightM = effectiveAltitudeM * (cameraPreset.sensor_height_mm / cameraPreset.focal_length_mm);
    const captureIntervalS = Math.max(0.2, Number(profile.capture_interval_s || 2));
    const waypointSpacingM = roundSpacing(footprintWidthM * (1 - frontOverlap));
    const recommendedGroundSpeedMps = Math.min(
      Number(profile.max_mapping_speed_mps || profile.cruise_speed_mps || 10),
      waypointSpacingM / captureIntervalS,
    );
    const gsdWidthCm =
      (effectiveAltitudeM * cameraPreset.sensor_width_mm) / (cameraPreset.image_width_px * cameraPreset.focal_length_mm) * 100;
    const gsdHeightCm =
      (effectiveAltitudeM * cameraPreset.sensor_height_mm) / (cameraPreset.image_height_px * cameraPreset.focal_length_mm) * 100;
    return {
      line_spacing_m: roundSpacing(footprintHeightM * (1 - sideOverlap)),
      waypoint_spacing_m: waypointSpacingM,
      capture_interval_s: roundSpacing(captureIntervalS),
      recommended_ground_speed_mps: roundSpacing(recommendedGroundSpeedMps),
      max_mapping_speed_mps: roundSpacing(Number(profile.max_mapping_speed_mps || profile.cruise_speed_mps || 10)),
      footprint_width_m: roundSpacing(footprintWidthM),
      footprint_height_m: roundSpacing(footprintHeightM),
      effective_altitude_m: roundSpacing(effectiveAltitudeM),
      gsd_width_cm: roundSpacing(gsdWidthCm),
      gsd_height_cm: roundSpacing(gsdHeightCm),
    };
  }

  const widthRatio = Number(profile.ground_footprint_width_ratio);
  const heightRatio = Number(profile.ground_footprint_height_ratio);
  if (!Number.isFinite(widthRatio) || !Number.isFinite(heightRatio)) {
    return null;
  }
  const footprintWidthM = effectiveAltitudeM * widthRatio;
  const footprintHeightM = effectiveAltitudeM * heightRatio;
  const captureIntervalS = Math.max(0.2, Number(profile.capture_interval_s || 2));
  const waypointSpacingM = roundSpacing(footprintHeightM * (1 - frontOverlap));
  const recommendedGroundSpeedMps = Math.min(
    Number(profile.max_mapping_speed_mps || profile.cruise_speed_mps || 10),
    waypointSpacingM / captureIntervalS,
  );
  return {
    line_spacing_m: roundSpacing(footprintWidthM * (1 - sideOverlap)),
    waypoint_spacing_m: waypointSpacingM,
    capture_interval_s: roundSpacing(captureIntervalS),
    recommended_ground_speed_mps: roundSpacing(recommendedGroundSpeedMps),
    max_mapping_speed_mps: roundSpacing(Number(profile.max_mapping_speed_mps || profile.cruise_speed_mps || 10)),
    effective_altitude_m: roundSpacing(effectiveAltitudeM),
  };
}

function syncParametersWithSuggestedSpacing(
  current: FlightMissionParameters,
  profile: DroneProfile | null,
): FlightMissionParameters {
  const resolvedPreset = getCameraPreset(profile, current.camera_preset_id);
  const nextCameraPresetId = resolvedPreset?.id ?? null;
  const suggestedSpacing = suggestSpacing(profile, current.altitude_m, nextCameraPresetId, current.ground_offset_m);
  if (!suggestedSpacing) return current;
  if (
    current.camera_preset_id === nextCameraPresetId &&
    current.line_spacing_m === suggestedSpacing.line_spacing_m &&
    current.waypoint_spacing_m === suggestedSpacing.waypoint_spacing_m
  ) {
    return current;
  }
  return {
    ...current,
    camera_preset_id: nextCameraPresetId,
    line_spacing_m: suggestedSpacing.line_spacing_m,
    waypoint_spacing_m: suggestedSpacing.waypoint_spacing_m,
  };
}

function durationTone(status: string | null): string {
  if (status === "over_limit") return "text-[color:var(--fb-accent-danger)]";
  if (status === "warning") return "text-[color:var(--fb-map-analysis-accent)]";
  return "text-[color:var(--fb-accent-emerald)]";
}

function missionStatusLabel(status: string | null): string {
  if (status === "over_limit") return "For lang";
  if (status === "warning") return "Nær grensen";
  if (status === "ok") return "Klar";
  return "";
}

function formatSourceDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

function sourceLabel(source: FieldPlotSource | FieldCandidate["source"] | string | null | undefined, provenance?: FieldSourceProvenance | null): string {
  const provenanceSource = provenance?.source?.trim().toLowerCase();
  if (provenanceSource === "geonorge" || source === "geonorge") return "Geonorge";
  if (source === "manual") return "Manuelt tegnet";
  if (source === "suggested") return "Foreslått";
  if (source === "imported") return "Importert";
  return "Ukjent kilde";
}

function sourceDetailParts(provenance?: FieldSourceProvenance | null): string[] {
  if (!provenance) return [];
  const parts: string[] = [];
  if (provenance.accuracy_class) parts.push(`Nøyaktighet ${provenance.accuracy_class}`);
  const updated = formatSourceDate(provenance.source_updated_at);
  if (updated) parts.push(`Oppdatert ${updated}`);
  const fetched = formatSourceDate(provenance.source_fetched_at);
  if (fetched) parts.push(`Hentet ${fetched}`);
  if (provenance.source_endpoint) parts.push(provenance.source_endpoint);
  return parts;
}

function sourceSummary(
  source: FieldPlotSource | FieldCandidate["source"] | string | null | undefined,
  provenance?: FieldSourceProvenance | null,
): string {
  const details = sourceDetailParts(provenance);
  return [sourceLabel(source, provenance), ...details].join(" · ");
}

function candidateSourceProvenance(candidate: FieldCandidate): FieldSourceProvenance {
  return {
    source: candidate.source,
    source_endpoint: candidate.source_endpoint,
    source_fetched_at: candidate.source_fetched_at,
    source_updated_at: candidate.source_updated_at,
    accuracy_class: candidate.accuracy_class,
    local_id: candidate.local_id,
    matrikkelnummer: candidate.matrikkelnummer,
    object_type: candidate.object_type,
    land_use_kind: candidate.land_use_kind,
    land_use_label: candidate.land_use_label,
  };
}

function classifyUnitBucket(unit: PlanningUnit, propertyLabel: string | undefined): UnitBucket {
  const haystack = [unit.name, unit.source_field_name, propertyLabel ?? ""].join(" ").toLocaleLowerCase("nb");
  if (haystack.includes("skog")) return "forest";
  if (haystack.includes("uavklart")) return "unknown";
  return "field";
}

function unitCountLabel(count: number): string {
  return count === 1 ? "1 område klart for planlegging." : `${count} områder klare for planlegging.`;
}

function normalizeMissionParameters(parameters: Partial<FlightMissionParameters> | null | undefined): FlightMissionParameters {
  const normalizedNoGoBuffers = Array.isArray(parameters?.no_go_buffers)
    ? parameters.no_go_buffers.map((buffer) => ({
        ...buffer,
        width_m: Number(buffer.width_m ?? ((buffer.radius_m ?? 15) * 2)),
        height_m: Number(buffer.height_m ?? ((buffer.radius_m ?? 15) * 2)),
      }))
    : [];
  return {
    ...DEFAULT_FLIGHT_MISSION_PARAMETERS,
    ...parameters,
    terrain_mode: parameters?.terrain_mode === "dem_agl" ? "dem_agl" : "flat",
    camera_preset_id: parameters?.camera_preset_id ?? null,
    ground_offset_m: Number(parameters?.ground_offset_m ?? 0),
    launch_point: parameters?.launch_point ?? null,
    landing_point: parameters?.landing_point ?? null,
    no_go_buffers: normalizedNoGoBuffers,
  };
}

type TerrainSummary = {
  terrain_mode: FlightMissionTerrainMode;
  requested_terrain_mode?: FlightMissionTerrainMode | string | null;
  terrain_source?: string | null;
  takeoff_reference_elevation_m?: number | null;
  min_terrain_elevation_m?: number | null;
  max_terrain_elevation_m?: number | null;
  min_relative_waypoint_height_m?: number | null;
  max_relative_waypoint_height_m?: number | null;
};

function getTerrainSummary(mission: FlightMissionPreview | FlightMission | null | undefined): TerrainSummary | null {
  const terrain = mission?.export_manifest && typeof mission.export_manifest === "object"
    ? (mission.export_manifest as Record<string, unknown>).terrain
    : null;
  if (!terrain || typeof terrain !== "object") return null;
  return terrain as TerrainSummary;
}

function createNoGoBuffer(point: GeoPoint): NoGoBuffer {
  return {
    id: `buffer-${Date.now()}-${Math.round(point.lat * 1000)}-${Math.round(point.lng * 1000)}`,
    name: null,
    center: point,
    width_m: 28,
    height_m: 20,
  };
}

function landUseTone(kind: string): string {
  if (kind === "field") return "text-[color:var(--fb-accent-emerald)]";
  if (kind === "forest") return "text-[color:var(--fb-map-forest)]";
  if (kind === "other") return "text-[color:var(--fb-accent-danger)]";
  return "text-fb-text-secondary";
}

function sortSuggestions(items: PlanningSuggestion[]): PlanningSuggestion[] {
  const rank = (kind: string) => {
    if (kind === "field") return 0;
    if (kind === "unknown") return 1;
    if (kind === "forest") return 2;
    return 3;
  };
  return [...items].sort(
    (a, b) =>
      rank(a.land_use_kind) - rank(b.land_use_kind) ||
      Number(a.distance_m ?? 10_000) - Number(b.distance_m ?? 10_000) ||
      a.name.localeCompare(b.name, "nb"),
  );
}

function extractCapturePoints(mission: FlightMission | FlightMissionPreview | null): MissionCapturePoint[] {
  if (!mission?.route_geojson?.features) return [];
  return mission.route_geojson.features
    .flatMap((feature) => {
      if (!feature || typeof feature !== "object") return [];
      const geometry = (feature as { geometry?: unknown }).geometry;
      const properties = (feature as { properties?: unknown }).properties;
      if (!geometry || typeof geometry !== "object" || !properties || typeof properties !== "object") return [];
      if ((geometry as { type?: unknown }).type !== "Point") return [];
      if ((properties as { kind?: unknown }).kind !== "waypoint") return [];
      const coordinates = (geometry as { coordinates?: unknown }).coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
      const lng = Number(coordinates[0]);
      const lat = Number(coordinates[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
      return [
        {
          sequence: Number((properties as { sequence?: unknown }).sequence ?? 0),
          lat,
          lng,
        },
      ];
    })
    .sort((a, b) => a.sequence - b.sequence);
}

function geometryKey(coordinates: number[][][] | null | undefined): string {
  if (!Array.isArray(coordinates)) return "";
  return JSON.stringify(
    coordinates.map((ring) =>
      Array.isArray(ring)
        ? ring.map((point) =>
            Array.isArray(point) && point.length >= 2
              ? [Number(point[0]).toFixed(6), Number(point[1]).toFixed(6)]
              : point,
          )
        : ring,
    ),
  );
}

export function PlanningPage({
  properties,
  canEdit,
  missions,
  activeMissionId,
  missionFocusToken,
  missionExportBusyId,
  missionDeleteBusyId,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  onSelectMission,
  onExportMission,
  onDeleteMission,
  onReloadMissions,
  onReloadProfile,
}: PlanningPageProps) {
  const propertyLabelById = useMemo(
    () =>
      new Map(
        properties.map((property) => [property.id, property.label?.trim() || `${property.gnr}/${property.bnr}`]),
      ),
    [properties],
  );
  const [units, setUnits] = useState<PlanningUnit[]>([]);
  const [unitsStatus, setUnitsStatus] = useState("Planenheter lastes …");
  const [scoutingTasks, setScoutingTasks] = useState<ScoutingTask[]>([]);
  const [scoutingStatusText, setScoutingStatusText] = useState("");
  const [scoutingBusy, setScoutingBusy] = useState(false);
  const [scoutingPatchBusyId, setScoutingPatchBusyId] = useState<number | null>(null);
  const [scoutingDraft, setScoutingDraft] = useState<ScoutingTaskDraft>({
    title: "",
    notes: "",
    lat: "",
    lng: "",
    priority: "normal",
  });
  const [profiles, setProfiles] = useState<DroneProfile[]>([]);
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [selectedDroneProfileId, setSelectedDroneProfileId] = useState<string>("");
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [selectedMissionUnitIds, setSelectedMissionUnitIds] = useState<number[]>([]);
  const [missionName, setMissionName] = useState("");
  const [parameters, setParameters] = useState<FlightMissionParameters>(DEFAULT_FLIGHT_MISSION_PARAMETERS);
  const [preview, setPreview] = useState<FlightMissionPreview | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [toolMode, setToolMode] = useState<PlanningToolMode>(initialToolMode(canEdit));
  const [splitPoints, setSplitPoints] = useState<GeoPoint[]>([]);
  const [findBusy, setFindBusy] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [fieldDeleteBusy, setFieldDeleteBusy] = useState(false);
  const [fieldGeometryBusy, setFieldGeometryBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncAllBusy, setSyncAllBusy] = useState(false);
  const [suggestionCreateKey, setSuggestionCreateKey] = useState<string | null>(null);
  const [suggestionFilter, setSuggestionFilter] = useState<SuggestionFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hoveredSuggestion, setHoveredSuggestion] = useState<PreviewSuggestion | null>(null);
  const [pinnedSuggestion, setPinnedSuggestion] = useState<PreviewSuggestion | null>(null);
  const [suggestionFocusToken, setSuggestionFocusToken] = useState(0);
  const [selectedNoGoBufferId, setSelectedNoGoBufferId] = useState<string | null>(null);
  const [playbackActive, setPlaybackActive] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);

  const selectedUnit = useMemo(
    () => units.find((item) => item.id === selectedUnitId) ?? null,
    [selectedUnitId, units],
  );
  const selectedUnitCenter = useMemo(() => unitApproxCenter(selectedUnit), [selectedUnit]);
  const selectedDroneProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedDroneProfileId) ?? null,
    [profiles, selectedDroneProfileId],
  );
  const selectedCameraPreset = useMemo(
    () => getCameraPreset(selectedDroneProfile, parameters.camera_preset_id),
    [parameters.camera_preset_id, selectedDroneProfile],
  );
  const suggestedSpacing = useMemo(
    () =>
      suggestSpacing(
        selectedDroneProfile,
        parameters.altitude_m,
        selectedCameraPreset?.id ?? parameters.camera_preset_id,
        parameters.ground_offset_m,
      ),
    [parameters.altitude_m, parameters.camera_preset_id, parameters.ground_offset_m, selectedCameraPreset?.id, selectedDroneProfile],
  );
  const editMode = toolMode === "edit";
  const splitMode = toolMode === "split";
  const resolveMode = toolMode === "resolve";
  const launchMode = toolMode === "launch";
  const landingMode = toolMode === "landing";
  const noGoMode = toolMode === "no_go";
  const activeMission = useMemo(
    () => missions.find((item) => item.id === activeMissionId) ?? null,
    [activeMissionId, missions],
  );
  const selectedUnitMission = useMemo(() => {
    if (!selectedUnit?.latest_mission_id) return null;
    return missions.find((item) => item.id === selectedUnit.latest_mission_id) ?? null;
  }, [missions, selectedUnit]);
  const selectedMissionExportHint = useMemo(() => {
    if (!selectedUnitMission?.drone_profile_id) return null;
    if (selectedUnitMission.drone_profile_id === "dji-mini-4-pro") {
      return {
        title: "DJI Fly",
        body: "Eksporten blir en KMZ for Mini 4 Pro. Lag en midlertidig waypoint-rute i DJI Fly, lukk appen, erstatt mission-filen med den eksporterte KMZ-filen, og åpne ruten igjen. Ikke lagre missionen på nytt i DJI Fly etter import.",
      };
    }
    if (selectedUnitMission.drone_profile_id.startsWith("dji-")) {
      return {
        title: "DJI KMZ",
        body: "Eksporten blir en DJI-kompatibel KMZ for den lagrede droneprofilen.",
      };
    }
    return {
      title: "Bundle",
      body: "Eksporten blir en generell bundle med rute og felter.",
    };
  }, [selectedUnitMission]);
  const displayedMission = useMemo(
    () => preview ?? (previewPending ? null : selectedUnitMission ?? (selectedUnit ? null : activeMission)),
    [activeMission, preview, previewPending, selectedUnit, selectedUnitMission],
  );
  const capturePoints = useMemo(() => extractCapturePoints(displayedMission), [displayedMission]);
  const playbackFootprint = useMemo(() => {
    if (!suggestedSpacing?.footprint_width_m || !suggestedSpacing?.footprint_height_m) return null;
    return {
      width_m: suggestedSpacing.footprint_width_m,
      height_m: suggestedSpacing.footprint_height_m,
    };
  }, [suggestedSpacing]);
  const previewWarnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
  const terrainSummary = useMemo(() => getTerrainSummary(preview), [preview]);
  const canSaveMission =
    canEdit &&
    selectedUnit != null &&
    selectedMissionUnitIds.length > 0 &&
    selectedDroneProfileId.trim().length > 0 &&
    !previewPending;
  const saveMissionHelp = !selectedDroneProfileId.trim()
    ? "Vent til droneprofilene er lastet før planen kan lagres."
    : previewPending
      ? "Vent til rutegrunnlaget er ferdig beregnet før planen lagres."
      : selectedUnitMission
        ? "Oppdater planen som allerede er lagret for dette området."
        : "Lagre en ny plan for dette området.";
  const unitGeometryKeys = useMemo(
    () => new Set(units.map((unit) => geometryKey(unit.geometry?.coordinates))),
    [units],
  );
  const visibleSuggestions = useMemo(
    () =>
      sortSuggestions(
        suggestions.filter((item) => {
          if (unitGeometryKeys.has(geometryKey(item.geometry?.coordinates))) return false;
          if (suggestionFilter === "all") return true;
          if (suggestionFilter === "unknown") return item.land_use_kind === "unknown" || item.land_use_kind === "other";
          return item.land_use_kind === suggestionFilter;
        }),
      ),
    [suggestionFilter, suggestions, unitGeometryKeys],
  );
  const normalizedSearch = useMemo(() => searchQuery.trim().toLocaleLowerCase("nb"), [searchQuery]);
  const filteredUnits = useMemo(() => {
    if (!normalizedSearch) return units;
    return units.filter((unit) => {
      const haystack = [
        unit.name,
        unit.source_field_name,
        sourceSummary(unit.source_field_source, unit.source_field_provenance),
        propertyLabelById.get(unit.property_id) ?? "",
      ]
        .join(" ")
        .toLocaleLowerCase("nb");
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, propertyLabelById, units]);
  const groupedUnits = useMemo(() => {
    const groups: Record<UnitBucket, PlanningUnit[]> = {
      field: [],
      forest: [],
      unknown: [],
    };
    filteredUnits.forEach((unit) => {
      groups[classifyUnitBucket(unit, propertyLabelById.get(unit.property_id))].push(unit);
    });
    return groups;
  }, [filteredUnits, propertyLabelById]);
  const filteredSuggestions = useMemo(() => {
    if (!normalizedSearch) return visibleSuggestions;
    return visibleSuggestions.filter((candidate) => {
      const haystack = [
        candidate.name,
        candidate.property_label,
        candidate.land_use_label,
        candidate.ar5_class ?? "",
        sourceSummary(candidate.source, candidateSourceProvenance(candidate)),
      ]
        .join(" ")
        .toLocaleLowerCase("nb");
      return haystack.includes(normalizedSearch);
    });
  }, [normalizedSearch, visibleSuggestions]);
  const previewSuggestion = pinnedSuggestion ?? hoveredSuggestion;

  const handleSelectUnit = useCallback(
    (unitId: number) => {
      const unit = units.find((item) => item.id === unitId) ?? null;
      setHoveredSuggestion(null);
      setPinnedSuggestion(null);
      setSelectedUnitId(unitId);
      setSelectedMissionUnitIds([unitId]);
      setSplitPoints([]);
      onSelectMission(unit?.latest_mission_id ?? null);
      if (!unit?.latest_mission_id) {
        setMissionName(unit?.name ? `Plan ${unit.name}` : "");
        setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
        setPreview(null);
        setPreviewStatus("");
      }
    },
    [onSelectMission, units],
  );

  const loadProfiles = useCallback(async () => {
    const { data } = await apiGet<DroneProfileListResponse>("/api/v1/drone-profiles", { cache: false, dedupe: false });
    const nextProfiles = Array.isArray(data?.profiles) ? data.profiles : [];
    setProfiles(nextProfiles);
    setSelectedDroneProfileId((current) => current || nextProfiles[0]?.id || "");
  }, []);

  const loadSuggestions = useCallback(async () => {
    if (properties.length === 0) {
      setSuggestions([]);
      return;
    }
    try {
      const responses = await Promise.all(
        properties.map((property) =>
          apiGet<FieldCandidateListResponse>(`/api/v1/properties/${property.id}/field-candidates`, {
            cache: false,
            dedupe: false,
          }).then((response) => ({
            property_id: property.id,
            property_label: propertyLabelById.get(property.id) ?? `${property.gnr}/${property.bnr}`,
            fields: Array.isArray(response.data?.fields) ? response.data.fields : [],
          })),
        ),
      );
      setSuggestions(
        responses.flatMap((response) =>
          response.fields.map((field) => ({
            ...field,
            property_id: response.property_id,
            property_label: response.property_label,
          })),
        ),
      );
    } catch {
      setSuggestions([]);
    }
  }, [properties, propertyLabelById]);

  const applyUnits = useCallback(
    (nextUnits: PlanningUnit[], statusText?: string) => {
      setUnits(nextUnits);
      setToolMode((current) => {
        if (current === "edit" || current === "split") return current;
        return initialToolMode(canEdit, nextUnits.length > 0);
      });
      setSelectedUnitId((current) => {
        if (current != null && nextUnits.some((item) => item.id === current)) {
          return current;
        }
        return nextUnits[0]?.id ?? null;
      });
      setSelectedMissionUnitIds((current) => {
        if (current.length > 0) {
          const filtered = current.filter((unitId) => nextUnits.some((item) => item.id === unitId));
          if (filtered.length > 0) return [filtered[0]];
        }
        return nextUnits[0] ? [nextUnits[0].id] : [];
      });
      setUnitsStatus(
        statusText ??
          (nextUnits.length === 0
            ? canEdit
              ? "Ingen områder ennå. Trykk Nytt område og klikk i kartet, eller hent inn områder under Innstillinger."
              : "Ingen områder lagt inn ennå."
            : unitCountLabel(nextUnits.length)),
      );
    },
    [canEdit],
  );

  const loadUnits = useCallback(async () => {
    if (properties.length === 0) {
      setUnits([]);
      setSelectedUnitId(null);
      setSelectedMissionUnitIds([]);
      setUnitsStatus("Legg til minst én aktiv eiendom for å åpne planlegging.");
      return;
    }
    try {
      const responses = await Promise.all(
        properties.map((property) =>
          apiGet<PlanningUnitListResponse>(`/api/v1/planning/properties/${property.id}/units`, {
            cache: false,
            dedupe: false,
          }).then((response) => (Array.isArray(response.data?.units) ? response.data.units : [])),
        ),
      );
      const nextUnits = responses
        .flat()
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
      applyUnits(nextUnits);
    } catch (error) {
      const apiError = error as ApiError;
      setUnits([]);
      setSelectedUnitId(null);
      setSelectedMissionUnitIds([]);
      setUnitsStatus(`Kunne ikke laste planlegging: ${apiError.message}`);
    }
  }, [applyUnits, properties]);

  const loadScoutingTasks = useCallback(async () => {
    if (!selectedUnit) {
      setScoutingTasks([]);
      setScoutingStatusText("");
      return;
    }
    try {
      const { data } = await apiGet<ScoutingTaskListResponse>("/api/v1/scouting/tasks", {
        query: { field_id: selectedUnit.source_field_plot_id },
        cache: false,
        dedupe: false,
      });
      const nextTasks = Array.isArray(data?.tasks) ? data.tasks : [];
      setScoutingTasks(nextTasks);
      setScoutingStatusText(
        nextTasks.length === 0 ? "Ingen feltoppgaver for dette området ennå." : `${nextTasks.length} feltoppgave${nextTasks.length === 1 ? "" : "r"} på området.`,
      );
    } catch (error) {
      const apiError = error as ApiError;
      setScoutingTasks([]);
      setScoutingStatusText(`Kunne ikke laste feltoppgaver: ${apiError.message}`);
    }
  }, [selectedUnit]);

  const handleSyncOwnedFields = useCallback(async () => {
    if (properties.length === 0 || !canEdit || syncAllBusy) return;
    setSyncAllBusy(true);
    try {
      const responses = await Promise.all(
        properties.map((property) =>
          apiPost<PlanningUnitSyncResponse>(`/api/v1/planning/properties/${property.id}/sync`).then((response) => ({
            units: Array.isArray(response.data?.units) ? response.data.units : [],
            created_count: Number(response.data?.created_count ?? 0),
          })),
        ),
      );
      const nextUnits = responses
        .flatMap((response) => response.units)
        .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id);
      const createdCount = responses.reduce((sum, response) => sum + response.created_count, 0);
      applyUnits(
        nextUnits,
        createdCount > 0
          ? `Hentet ${createdCount} nye område${createdCount === 1 ? "" : "r"} fra eiendommene dine.`
          : nextUnits.length > 0
            ? "Alle områdene er allerede klare i listen."
            : "Fant ingen nye områder å legge inn.",
      );
      setSettingsOpen(false);
      await loadSuggestions();
    } catch (error) {
      const apiError = error as ApiError;
      setUnitsStatus(`Kunne ikke hente områder: ${apiError.message}`);
    } finally {
      setSyncAllBusy(false);
    }
  }, [applyUnits, canEdit, loadSuggestions, properties, syncAllBusy]);

  useEffect(() => {
    if (selectedUnitId == null) {
      setSelectedMissionUnitIds([]);
      return;
    }
    setSelectedMissionUnitIds((current) => {
      if (current.length === 1 && current[0] === selectedUnitId) {
        return current;
      }
      return [selectedUnitId];
    });
  }, [selectedUnitId]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (selectedUnitId == null) {
      setScoutingDraft((current) => ({
        ...current,
        title: "",
        notes: "",
        lat: "",
        lng: "",
      }));
      return;
    }
    setScoutingDraft((current) => ({
      ...current,
      title: "",
      notes: "",
      lat: selectedUnitCenter ? selectedUnitCenter.lat.toFixed(6) : "",
      lng: selectedUnitCenter ? selectedUnitCenter.lng.toFixed(6) : "",
    }));
  }, [selectedUnitCenter, selectedUnitId]);

  useEffect(() => {
    void loadScoutingTasks();
  }, [loadScoutingTasks]);

  useEffect(() => {
    setMissionName("");
    setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
    setSelectedNoGoBufferId(null);
    setPreview(null);
    setPreviewStatus("");
    setSplitPoints([]);
    void Promise.all([loadUnits(), loadSuggestions()]);
  }, [canEdit, loadSuggestions, loadUnits]);

  useEffect(() => {
    if (selectedUnit != null) return;
    if (toolMode === "edit" || toolMode === "split" || toolMode === "launch" || toolMode === "landing" || toolMode === "no_go") {
      setToolMode(initialToolMode(canEdit, units.length > 0));
      setSplitPoints([]);
    }
  }, [canEdit, selectedUnit, toolMode, units.length]);

  useEffect(() => {
    setSettingsOpen(false);
  }, [properties]);

  useEffect(() => {
    if (!selectedUnit || selectedMissionUnitIds.length === 0 || !selectedDroneProfileId) {
      setPreviewPending(false);
      setPreview(null);
      setPreviewStatus("");
      return;
    }

    let cancelled = false;
    setPreviewPending(true);
    setPreview(null);
    setPreviewStatus("Oppdaterer rute …");
    void apiPost<FlightMissionPreview>("/api/v1/flight-missions/preview", {
      property_id: selectedUnit.property_id,
      name: missionName || undefined,
      planning_unit_ids: selectedMissionUnitIds,
      drone_profile_id: selectedDroneProfileId,
      parameters,
    })
      .then(({ data }) => {
        if (cancelled) return;
        setPreview(data);
        setPreviewPending(false);
        setPreviewStatus("");
      })
      .catch((error) => {
        if (cancelled) return;
        const apiError = error as ApiError;
        setPreviewPending(false);
        setPreview(null);
        setPreviewStatus(`Kunne ikke beregne plan: ${apiError.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [missionName, parameters, selectedDroneProfileId, selectedMissionUnitIds, selectedUnit]);

  useEffect(() => {
    setPlaybackIndex(0);
    if (capturePoints.length === 0) {
      setPlaybackActive(false);
    }
  }, [capturePoints.length, displayedMission?.name]);

  useEffect(() => {
    if (!playbackActive || capturePoints.length <= 1) return;
    const timer = window.setInterval(() => {
      setPlaybackIndex((current) => (current + 1) % capturePoints.length);
    }, 420);
    return () => {
      window.clearInterval(timer);
    };
  }, [capturePoints.length, playbackActive]);

  useEffect(() => {
    if (!selectedUnit) {
      setMissionName("");
      setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
      setSelectedNoGoBufferId(null);
      setPreviewPending(false);
      setPreview(null);
    setPreviewStatus("");
      return;
    }

    if (activeMission && activeMission.property_id === selectedUnit.property_id) {
      const missionUnitIds = (
        Array.isArray(activeMission.planning_unit_ids) && activeMission.planning_unit_ids.length > 0
          ? activeMission.planning_unit_ids
          : activeMission.fields
              .map((field) => field.planning_unit_id)
              .filter((unitId): unitId is number => typeof unitId === "number")
      ).filter((unitId, index, items) => items.indexOf(unitId) === index);

      if (missionUnitIds.includes(selectedUnit.id)) {
        const nextProfileId = activeMission.drone_profile_id || selectedDroneProfileId;
        const nextProfile = profiles.find((profile) => profile.id === nextProfileId) ?? selectedDroneProfile;
        setSelectedMissionUnitIds([selectedUnit.id]);
        setMissionName(activeMission.name ?? selectedUnit.name);
        setSelectedDroneProfileId((current) => activeMission.drone_profile_id || current);
        setParameters(syncParametersWithSuggestedSpacing(normalizeMissionParameters(activeMission.parameters), nextProfile));
        setSelectedNoGoBufferId(activeMission.parameters?.no_go_buffers?.[0]?.id ?? null);
        setPreviewPending(false);
        setPreview(activeMission);
        setPreviewStatus("");
        setToolMode((current) =>
          current === "resolve" || current === "launch" || current === "landing" || current === "no_go"
            ? current
            : "select",
        );
        setSplitPoints([]);
        return;
      }
    }

    setSelectedMissionUnitIds([selectedUnit.id]);
    setMissionName(selectedUnit.name);
    setParameters(syncParametersWithSuggestedSpacing(DEFAULT_FLIGHT_MISSION_PARAMETERS, selectedDroneProfile));
    setSelectedNoGoBufferId(null);
    setPreviewPending(false);
    setPreview(null);
    setPreviewStatus("");
    setToolMode((current) =>
      current === "edit" ||
      current === "split" ||
      current === "resolve" ||
      current === "launch" ||
      current === "landing" ||
      current === "no_go"
        ? current
        : "select",
    );
    setSplitPoints([]);
  }, [activeMission, profiles, selectedDroneProfile, selectedDroneProfileId, selectedUnit]);

  useEffect(() => {
    if (!suggestedSpacing) return;
    setParameters((current) => syncParametersWithSuggestedSpacing(current, selectedDroneProfile));
  }, [selectedDroneProfile, suggestedSpacing]);

  const handleAddSplitPoint = useCallback(
    (point: GeoPoint) => {
      if (!selectedUnit || splitBusy) return;
      setSplitPoints((current) => {
        const next = [...current, point].slice(-2);
        if (next.length === 2) {
          setSplitBusy(true);
          void apiPost<PlanningUnitSplitResponse>(`/api/v1/planning/units/${selectedUnit.id}/split`, {
            line: {
              type: "LineString",
              coordinates: next.map((item) => [item.lng, item.lat]),
            },
          })
            .then(({ data }) => {
              setUnits((currentUnits) => {
                const remaining = currentUnits.filter((item) => item.id !== data.archived_unit.id);
                return [data.created_units[0], data.created_units[1], ...remaining];
              });
              setSelectedUnitId(data.created_units[0]?.id ?? null);
              setSelectedMissionUnitIds(data.created_units[0] ? [data.created_units[0].id] : []);
              setUnitsStatus("Jordet ble delt. Første del er valgt i planen.");
              setToolMode("select");
              setSplitPoints([]);
            })
            .catch((error) => {
              const apiError = error as ApiError;
              setUnitsStatus(`Kunne ikke dele planenhet: ${apiError.message}`);
              setSplitPoints([]);
            })
            .finally(() => {
              setSplitBusy(false);
            });
        }
        return next;
      });
    },
    [selectedUnit, splitBusy],
  );

  const handleSetLaunchPoint = useCallback((point: GeoPoint) => {
    if (!canEdit) return;
    setParameters((current) => ({
      ...current,
      launch_point: point,
    }));
    setPreviewStatus("Oppdaterer rute med nytt startpunkt …");
    setToolMode("select");
  }, [canEdit]);

  const handleSetLandingPoint = useCallback((point: GeoPoint) => {
    if (!canEdit) return;
    setParameters((current) => ({
      ...current,
      landing_point: point,
    }));
    setPreviewStatus("Oppdaterer rute med nytt landingspunkt …");
    setToolMode("select");
  }, [canEdit]);

  const handleCopyLaunchPointToLanding = useCallback(() => {
    if (!canEdit) return;
    setParameters((current) => {
      if (!current.launch_point) return current;
      return {
        ...current,
        landing_point: current.launch_point,
      };
    });
    setPreviewStatus("Oppdaterer rute med samme start- og landingspunkt …");
    setToolMode("select");
  }, [canEdit]);

  const handleAddNoGoBuffer = useCallback((point: GeoPoint) => {
    if (!canEdit) return;
    const nextBuffer = createNoGoBuffer(point);
    setSelectedNoGoBufferId(nextBuffer.id);
    setParameters((current) => ({
      ...current,
      no_go_buffers: [...current.no_go_buffers, nextBuffer],
    }));
    setPreviewStatus("Oppdaterer rute med nytt hinder …");
  }, [canEdit]);

  const handleUpdateNoGoBufferSize = useCallback(
    (bufferId: string | null, nextSize: Partial<Pick<NoGoBuffer, "width_m" | "height_m" | "center">>) => {
      if (!canEdit) return;
      if (!bufferId) return;
      setParameters((current) => ({
        ...current,
        no_go_buffers: current.no_go_buffers.map((buffer) =>
          buffer.id === bufferId
            ? {
                ...buffer,
                ...nextSize,
                width_m: Math.max(6, Number(nextSize.width_m ?? buffer.width_m)),
                height_m: Math.max(6, Number(nextSize.height_m ?? buffer.height_m)),
                center: nextSize.center ?? buffer.center,
              }
            : buffer,
        ),
      }));
      setPreviewStatus("Oppdaterer rute etter hinderendring …");
    },
    [canEdit],
  );

  const handleRemoveNoGoBuffer = useCallback((bufferId: string | null) => {
    if (!canEdit) return;
    if (!bufferId) return;
    setSelectedNoGoBufferId((current) => (current === bufferId ? null : current));
    setParameters((current) => ({
      ...current,
      no_go_buffers: current.no_go_buffers.filter((buffer) => buffer.id !== bufferId),
    }));
    setPreviewStatus("Oppdaterer rute uten hinderet …");
  }, [canEdit]);

  const handleCreateScoutingTask = useCallback(async () => {
    if (!canEdit || !selectedUnit || scoutingBusy) return;
    const lat = Number(scoutingDraft.lat);
    const lng = Number(scoutingDraft.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      setScoutingStatusText("Skriv inn gyldig bredde- og lengdegrad for feltfunnet.");
      return;
    }
    setScoutingBusy(true);
    try {
      const title = scoutingDraft.title.trim() || `Funn i ${selectedUnit.name}`;
      const { data } = await apiPost<ScoutingTask>("/api/v1/scouting/tasks", {
        property_id: selectedUnit.property_id,
        field_id: selectedUnit.source_field_plot_id,
        planning_unit_id: selectedUnit.id,
        title,
        notes: scoutingDraft.notes.trim() || null,
        priority: scoutingDraft.priority,
        position: { lat, lng },
      });
      setScoutingTasks((current) => [data, ...current.filter((item) => item.id !== data.id)]);
      setScoutingDraft((current) => ({
        ...current,
        title: "",
        notes: "",
      }));
      setScoutingStatusText(`Lagret feltoppgave: ${data.title}.`);
    } catch (error) {
      const apiError = error as ApiError;
      setScoutingStatusText(`Kunne ikke lagre feltoppgave: ${apiError.message}`);
    } finally {
      setScoutingBusy(false);
    }
  }, [canEdit, scoutingBusy, scoutingDraft, selectedUnit]);

  const handlePatchScoutingTaskStatus = useCallback(
    async (task: ScoutingTask, status: ScoutingTaskStatus) => {
      if (!canEdit || scoutingPatchBusyId != null) return;
      setScoutingPatchBusyId(task.id);
      try {
        const { data } = await apiPatch<ScoutingTask>(`/api/v1/scouting/tasks/${task.id}`, { status });
        setScoutingTasks((current) => current.map((item) => (item.id === data.id ? data : item)));
        setScoutingStatusText(`${data.title} er satt til ${scoutingStatusLabel(data.status).toLocaleLowerCase("nb")}.`);
      } catch (error) {
        const apiError = error as ApiError;
        setScoutingStatusText(`Kunne ikke oppdatere feltoppgave: ${apiError.message}`);
      } finally {
        setScoutingPatchBusyId(null);
      }
    },
    [canEdit, scoutingPatchBusyId],
  );

  const handleResolvePoint = useCallback(
    async (point: GeoPoint) => {
    if (
      properties.length === 0 ||
      !canEdit ||
      findBusy ||
      splitMode ||
      editMode ||
      launchMode ||
      landingMode ||
      noGoMode ||
      !resolveMode
    ) {
      return;
    }
      setFindBusy(true);
      try {
        let response;
        try {
          response = await apiPost<PlanningPointResolveResponse>("/api/v1/planning/resolve-point", {
            lat: point.lat,
            lng: point.lng,
            radius_m: RESOLVE_PRIMARY_RADIUS_M,
          });
        } catch (error) {
          const apiError = error as ApiError;
          if (apiError.status !== 404) {
            throw apiError;
          }
          response = await apiPost<PlanningPointResolveResponse>("/api/v1/planning/resolve-point", {
            lat: point.lat,
            lng: point.lng,
            radius_m: RESOLVE_FALLBACK_RADIUS_M,
          });
        }
        const { data } = response;
        setUnits((currentUnits) => {
          const nextUnit = data.unit;
          const remaining = currentUnits.filter((item) => item.id !== nextUnit.id);
          return [nextUnit, ...remaining];
        });
        setSelectedUnitId(data.unit.id);
        setSelectedMissionUnitIds([data.unit.id]);
        if (data.property_created) {
          await onReloadProfile();
        }
        setUnitsStatus(
          data.imported_field
            ? `Fant og importerte ${data.candidate_name ?? data.unit.name} fra ${data.property_label ?? propertyLabelById.get(data.property_id) ?? data.matrikkelnummer ?? "teigen"}. Nytt område er fortsatt aktivt.`
            : `Fant ${data.candidate_name ?? data.unit.name} og valgte den i planen. Nytt område er fortsatt aktivt.`,
        );
        await loadSuggestions();
      } catch (error) {
        const apiError = error as ApiError;
        if (apiError.status === 404) {
          setUnitsStatus("Fant ingen teig der. Klikk lenger inn i teigen og prøv igjen.");
        } else {
          setUnitsStatus(`Kunne ikke finne område fra kartklikk: ${apiError.message}`);
        }
      } finally {
        setFindBusy(false);
      }
    },
    [
      canEdit,
      editMode,
      findBusy,
      landingMode,
      launchMode,
      loadSuggestions,
      noGoMode,
      onReloadProfile,
      properties.length,
      propertyLabelById,
      resolveMode,
      splitMode,
    ],
  );

  const handleCreateUnitFromSuggestion = useCallback(
    async (candidate: PlanningSuggestion) => {
      if (!canEdit) return;
      const candidateKey = `${candidate.local_id ?? candidate.name}-${geometryKey(candidate.geometry?.coordinates)}`;
      setSuggestionCreateKey(candidateKey);
      try {
        setHoveredSuggestion(null);
        setPinnedSuggestion(null);
        const createdField = await apiPost<FieldPlot>("/api/v1/fields", {
          property_id: candidate.property_id,
          name: candidate.name,
          source: "imported",
          status: "draft",
          geometry: candidate.geometry,
          source_provenance: candidateSourceProvenance(candidate),
        });
        const syncResponse = await apiPost<PlanningUnitSyncResponse>(`/api/v1/planning/properties/${candidate.property_id}/sync`);
        const syncedUnits = Array.isArray(syncResponse.data?.units) ? syncResponse.data.units : [];
        const untouchedUnits = units.filter((item) => item.property_id !== candidate.property_id);
        const nextUnits = [...syncedUnits, ...untouchedUnits].sort(
          (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id,
        );
        applyUnits(nextUnits, `${candidate.name} ble lagt inn som område.`);
        const createdUnit = nextUnits.find((item) => item.source_field_plot_id === createdField.data.id) ?? null;
        if (createdUnit) {
          setSelectedUnitId(createdUnit.id);
          setSelectedMissionUnitIds([createdUnit.id]);
          onSelectMission(createdUnit.latest_mission_id ?? null);
        }
        await loadSuggestions();
      } catch (error) {
        const apiError = error as ApiError;
        setUnitsStatus(`Kunne ikke opprette område fra forslag: ${apiError.message}`);
      } finally {
        setSuggestionCreateKey(null);
      }
    },
    [applyUnits, canEdit, loadSuggestions, onSelectMission, units],
  );

  const handleCreateMission = useCallback(async () => {
    if (!canSaveMission) return;
    setCreateBusy(true);
    try {
      const payload = {
        property_id: selectedUnit?.property_id,
        name: missionName || undefined,
        planning_unit_ids: selectedMissionUnitIds,
        drone_profile_id: selectedDroneProfileId || undefined,
        parameters,
      };
      const targetMissionId = selectedUnitMission?.id ?? activeMissionId;
      const response = targetMissionId
        ? await apiPatch<FlightMission>(`/api/v1/flight-missions/${targetMissionId}`, payload)
        : await apiPost<FlightMission>("/api/v1/flight-missions", payload);
      const savedMission = response.data;
      setPreview(savedMission);
      setUnitsStatus(
        targetMissionId
          ? `Oppdaterte planen for ${selectedUnit?.name ?? savedMission.name}.`
          : `Lagret ${savedMission.name} som flyoppdrag.`,
      );
      await Promise.all([loadUnits(), onReloadMissions()]);
      onSelectMission(savedMission.id);
    } catch (error) {
      const apiError = error as ApiError;
      setUnitsStatus(`Kunne ikke ${selectedUnitMission?.id ?? activeMissionId ? "oppdatere" : "lagre"} plan: ${apiError.message}`);
    } finally {
      setCreateBusy(false);
    }
  }, [
    activeMissionId,
    canSaveMission,
    loadUnits,
    missionName,
    onReloadMissions,
    onSelectMission,
    parameters,
    selectedDroneProfileId,
    selectedUnit,
    selectedUnitMission?.id,
    selectedMissionUnitIds,
  ]);

  const handleUpdateSelectedFieldGeometry = useCallback(
    async (geometry: PlanningUnit["geometry"]) => {
      if (!canEdit || !selectedUnit || selectedUnit.parent_unit_id != null) return;
      setUnits((current) =>
        current.map((unit) =>
          unit.id === selectedUnit.id
            ? {
                ...unit,
                geometry,
              }
            : unit,
        ),
      );
      setPreviewStatus("Lagrer avgrensning …");
      setFieldGeometryBusy(true);
      try {
        await apiPatch(`/api/v1/fields/${selectedUnit.source_field_plot_id}`, {
          geometry,
        });
        await loadUnits();
        setUnitsStatus(`Oppdaterte avgrensningen for ${selectedUnit.source_field_name}.`);
      } catch (error) {
        const apiError = error as ApiError;
        setUnits((current) =>
          current.map((unit) =>
            unit.id === selectedUnit.id
              ? {
                  ...unit,
                  geometry: selectedUnit.geometry,
                }
              : unit,
          ),
        );
        setPreview(null);
        setPreviewStatus("");
        setUnitsStatus(`Kunne ikke oppdatere området: ${apiError.message}`);
      } finally {
        setFieldGeometryBusy(false);
      }
    },
    [canEdit, loadUnits, selectedUnit],
  );

  const handleDeleteSelectedField = useCallback(async () => {
    if (!canEdit || !selectedUnit) return;
    const confirmed = window.confirm(`Slette ${selectedUnit.source_field_name} permanent?`);
    if (!confirmed) return;

    setFieldDeleteBusy(true);
    try {
      await apiDelete<FieldPlotDeleteResponse>(`/api/v1/fields/${selectedUnit.source_field_plot_id}`);
      if (activeMission?.fields.some((field) => field.field_id === selectedUnit.source_field_plot_id)) {
        onSelectMission(null);
      }
      await Promise.all([loadUnits(), loadSuggestions(), onReloadMissions()]);
      setToolMode(canEdit ? "resolve" : "select");
      setUnitsStatus(`Slettet ${selectedUnit.source_field_name}.`);
    } catch (error) {
      const apiError = error as ApiError;
      setUnitsStatus(`Kunne ikke slette området: ${apiError.message}`);
    } finally {
      setFieldDeleteBusy(false);
    }
  }, [activeMission, canEdit, loadSuggestions, loadUnits, onReloadMissions, onSelectMission, selectedUnit]);

  const handleStartNewField = useCallback(() => {
    onSelectMission(null);
    setSelectedUnitId(null);
    setHoveredSuggestion(null);
    setPinnedSuggestion(null);
    setSelectedMissionUnitIds([]);
    setMissionName("");
    setParameters(syncParametersWithSuggestedSpacing(DEFAULT_FLIGHT_MISSION_PARAMETERS, selectedDroneProfile));
    setSelectedNoGoBufferId(null);
    setPreview(null);
    setPreviewStatus("Klikk i kartet for å hente inn et område.");
    setUnitsStatus("Nytt område er aktivt. Klikk lenger inn i området du vil hente inn.");
    setToolMode(canEdit ? "resolve" : "select");
    setSplitPoints([]);
    setSettingsOpen(false);
  }, [canEdit, onSelectMission, selectedDroneProfile]);

  const handlePreviewSuggestion = useCallback(
    (candidate: PlanningSuggestion, pin = false) => {
      const candidateKey = `${candidate.local_id ?? candidate.name}-${geometryKey(candidate.geometry?.coordinates)}`;
      const preview: PreviewSuggestion = {
        key: candidateKey,
        name: candidate.name,
        propertyLabel: candidate.property_label,
        geometry: candidate.geometry,
      };
      setSelectedUnitId(null);
      onSelectMission(null);
      setPreview(null);
      setPreviewStatus("");
      if (pin) {
        setPinnedSuggestion(preview);
        setSuggestionFocusToken((current) => current + 1);
      } else {
        setHoveredSuggestion(preview);
      }
    },
    [onSelectMission],
  );

  const handleLeaveSuggestion = useCallback((candidate: PlanningSuggestion) => {
    const candidateKey = `${candidate.local_id ?? candidate.name}-${geometryKey(candidate.geometry?.coordinates)}`;
    setHoveredSuggestion((current) => (current?.key === candidateKey ? null : current));
  }, []);

  return (
    <div className="grid h-full min-h-0 gap-4 p-3 md:grid-cols-[21rem,minmax(0,1fr)] md:p-4">
      <aside className="flex min-h-0 flex-col overflow-hidden bg-fb-surface-page">
        <div className="relative px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <p className="pt-1 text-[11px] uppercase tracking-[0.12em] text-fb-text-secondary">Områder</p>
            <div className="flex shrink-0 items-center gap-2">
              <HoverActionButton
                type="button"
                size="sm"
                variant="default"
                onClick={handleStartNewField}
                disabled={!canEdit || properties.length === 0}
                help="Start et nytt område ved å klikke i kartet."
              >
                <Plus className="h-3.5 w-3.5" />
                Nytt område
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSettingsOpen((current) => !current)}
                disabled={!canEdit || properties.length === 0}
                help="Åpne handlinger for å hente inn områder fra eiendommene dine."
              >
                <Settings2 className="h-3.5 w-3.5" />
              </HoverActionButton>
            </div>
          </div>
          {settingsOpen ? (
            <div className="absolute right-4 top-[calc(100%-0.35rem)] z-20 w-64 rounded-xl bg-fb-surface-page p-2 shadow-fb-floating">
              <HoverActionButton
                type="button"
                variant="ghost"
                className="w-full justify-start"
                onClick={() => void handleSyncOwnedFields()}
                loading={syncAllBusy}
                loadingLabel="Henter områder"
                help="Hent inn områder fra eiendommene dine og legg dem i listen."
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Hent områder
              </HoverActionButton>
            </div>
          ) : null}
          <p className="sr-only" aria-live="polite">
            {unitsStatus}
          </p>
        </div>

        <div className="px-4 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fb-text-secondary" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Filtrer områder og forslag …"
              className="w-full rounded-xl bg-fb-surface-ghost px-9 py-2.5 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-fb-border-subtle">
            <section className="px-4 py-3">
              {filteredUnits.length === 0 ? (
                <div className="px-1 py-4 text-sm text-fb-text-secondary">Ingen områder ennå.</div>
              ) : (
                <div className="space-y-4">
                  {([
                    ["field", "Til flyging"],
                    ["forest", "Skogområder"],
                    ["unknown", "Andre områder"],
                  ] as const).map(([bucket, label]) => {
                    const items = groupedUnits[bucket];
                    if (items.length === 0) return null;
                    return (
                      <div key={bucket}>
                        <div className="mb-1 flex items-center justify-between px-2">
                          <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">{label}</p>
                          <span className="text-[11px] text-fb-text-secondary">{items.length}</span>
                        </div>
                        <div>
                          {items.map((unit, index) => {
                            const active = unit.id === selectedUnitId;
                            return (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() => handleSelectUnit(unit.id)}
                                className={cn(
                                  "w-full px-2 py-3 text-left transition-colors",
                                  active ? "bg-fb-surface-ghost" : "bg-transparent hover:bg-fb-surface-ghost/60",
                                  index > 0 ? "border-t border-fb-border-subtle" : "",
                                )}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-fb-text-primary">{unit.name}</p>
                                    <p className="mt-1 text-xs text-fb-text-secondary">
                                      {propertyLabelById.get(unit.property_id) ?? `${unit.property_id}`} · {formatArea(unit.area_ha)}
                                    </p>
                                    <p className="mt-1 text-[11px] text-fb-text-secondary">
                                      {sourceSummary(unit.source_field_source, unit.source_field_provenance)}
                                    </p>
                                  </div>
                                  {unit.latest_duration_status ? (
                                    <div className="flex flex-col items-end gap-1">
                                      <span className={cn("text-[11px] font-medium", durationTone(unit.latest_duration_status))}>
                                        {missionStatusLabel(unit.latest_duration_status)}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {filteredSuggestions.length > 0 ? (
              <section className="px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Forslag</p>
                  <span className="text-xs text-fb-text-secondary">{filteredSuggestions.length}</span>
                </div>
                <div className="mb-3 flex flex-wrap gap-2">
                  {([
                    ["all", "Alle"],
                    ["field", "Flyflater"],
                    ["forest", "Skog"],
                    ["unknown", "Andre"],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSuggestionFilter(value)}
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        suggestionFilter === value
                          ? "bg-fb-surface-ghost text-fb-text-primary"
                          : "text-fb-text-secondary hover:bg-fb-surface-ghost/70",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div>
                {filteredSuggestions.slice(0, 12).map((candidate, index) => {
                  const candidateKey = `${candidate.local_id ?? candidate.name}-${geometryKey(candidate.geometry?.coordinates)}`;
                  return (
                    <div
                      key={candidateKey}
                      className={cn(
                        "px-3 py-3 transition-colors",
                        index > 0 ? "border-t border-fb-border-subtle" : "",
                        previewSuggestion?.key === candidateKey ? "bg-fb-surface-ghost" : "",
                      )}
                      onMouseEnter={() => handlePreviewSuggestion(candidate)}
                      onMouseLeave={() => handleLeaveSuggestion(candidate)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-fb-text-primary">{candidate.name}</p>
                          <p className="mt-1 text-xs text-fb-text-secondary">
                            {candidate.property_label} · {formatArea(candidate.area_ha)}
                          </p>
                          <p className={cn("mt-1 text-xs font-medium", landUseTone(candidate.land_use_kind))}>
                            {candidate.land_use_label}
                            {candidate.ar5_class ? ` · ${candidate.ar5_class}` : ""}
                          </p>
                          <p className="mt-1 text-[11px] text-fb-text-secondary">
                            {sourceSummary(candidate.source, candidateSourceProvenance(candidate))}
                          </p>
                        </div>
                        <span className="text-[11px] font-medium text-fb-text-secondary">Forslag</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <HoverActionButton
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePreviewSuggestion(candidate, true)}
                          help="Vis hvor dette området ligger i kartet uten å opprette det."
                        >
                          Vis i kart
                        </HoverActionButton>
                        <HoverActionButton
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleCreateUnitFromSuggestion(candidate)}
                          disabled={!canEdit}
                          loading={suggestionCreateKey === candidateKey}
                          loadingLabel="Oppretter"
                          help="Opprett dette området og åpne det i planleggingen."
                        >
                          Opprett område
                        </HoverActionButton>
                      </div>
                    </div>
                  );
                })}
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </aside>

      <section className="min-h-0 overflow-hidden bg-fb-surface-page">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              {selectedUnit && previewStatus ? <p className="mt-1 text-sm text-fb-text-secondary">{previewStatus}</p> : null}
            </div>
            {selectedUnit ? (
              <div className="flex flex-wrap gap-2">
                <HoverActionButton
                  type="button"
                  size="sm"
                  variant={playbackActive ? "default" : "ghost"}
                  onClick={() => {
                    if (playbackActive) {
                      setPlaybackActive(false);
                      setPlaybackIndex(0);
                      return;
                    }
                    setPlaybackIndex(0);
                    setPlaybackActive(true);
                  }}
                  disabled={capturePoints.length === 0 || !playbackFootprint}
                  help="Spill av ruta og vis hva kamera dekker ved hvert bildepunkt."
                >
                  {playbackActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {playbackActive ? "Stop preview" : "Preview"}
                </HoverActionButton>
                <HoverActionButton
                  type="button"
                  size="sm"
                  variant={editMode ? "default" : "ghost"}
                  onClick={() => {
                    setToolMode(toolMode === "edit" ? "select" : "edit");
                    setSplitPoints([]);
                  }}
                  disabled={!canEdit || selectedUnit.parent_unit_id != null}
                  loading={fieldGeometryBusy}
                  loadingLabel="Lagrer område"
                  help={
                    selectedUnit.parent_unit_id != null
                      ? "Finjustering med dragging er foreløpig bare tilgjengelig for hele områder."
                      : "Dra i punktene i kartet for å justere grensen."
                  }
                >
                  <PencilLine className="h-3.5 w-3.5" />
                  {editMode ? "Redigerer" : "Rediger"}
                </HoverActionButton>
                <HoverActionButton
                  type="button"
                  size="sm"
                  variant={splitMode ? "default" : "ghost"}
                  onClick={() => {
                    setToolMode(toolMode === "split" ? "select" : "split");
                    setSplitPoints([]);
                  }}
                  disabled={!canEdit}
                  loading={splitBusy}
                  loadingLabel="Deler"
                  help="Del området ved å klikke to punkter i kartet."
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Del
                </HoverActionButton>
                <HoverActionButton
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleDeleteSelectedField()}
                  disabled={!canEdit}
                  loading={fieldDeleteBusy}
                  loadingLabel="Sletter område"
                  help="Slett hele området permanent."
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Slett område
                </HoverActionButton>
              </div>
            ) : null}
          </div>
        </div>

        <div className="grid h-[calc(100%-5.5rem)] min-h-0 gap-0 lg:grid-cols-[minmax(0,1fr),22rem]">
          <div className="relative min-h-[24rem]">
            <div className="absolute left-3 top-3 z-[700] flex gap-2 rounded-2xl bg-fb-surface-page/92 p-2 backdrop-blur">
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "select" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode("select");
                  setSplitPoints([]);
                }}
                help="Velg et område i kartet eller listen."
              >
                <MousePointer2 className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "resolve" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode("resolve");
                  setSplitPoints([]);
                }}
                disabled={!canEdit}
                loading={findBusy}
                loadingLabel="Finner"
                help="Klikk i kartet for å lage et nytt område fra kartdata."
              >
                <Plus className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "launch" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode(toolMode === "launch" ? "select" : "launch");
                  setSplitPoints([]);
                }}
                disabled={!canEdit || !selectedUnit}
                help="Klikk i kartet for å sette startpunkt."
              >
                <MapPin className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "landing" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode(toolMode === "landing" ? "select" : "landing");
                  setSplitPoints([]);
                }}
                disabled={!canEdit || !selectedUnit}
                help="Klikk i kartet for å sette landingspunkt."
              >
                <Plane className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "no_go" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode(toolMode === "no_go" ? "select" : "no_go");
                  setSplitPoints([]);
                }}
                disabled={!canEdit || !selectedUnit}
                help="Klikk i kartet for å legge inn en hinderbuffer / no-go sone."
              >
                <CircleOff className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "edit" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode(toolMode === "edit" ? "select" : "edit");
                  setSplitPoints([]);
                }}
                disabled={!canEdit || !selectedUnit || selectedUnit.parent_unit_id != null}
                loading={fieldGeometryBusy}
                loadingLabel="Lagrer"
                help="Dra i punktene rundt valgt område for å justere grensen."
              >
                <PencilLine className="h-4 w-4" />
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="icon"
                variant={toolMode === "split" ? "default" : "ghost"}
                onClick={() => {
                  setToolMode(toolMode === "split" ? "select" : "split");
                  setSplitPoints([]);
                }}
                disabled={!canEdit || !selectedUnit}
                loading={splitBusy}
                loadingLabel="Deler"
                help="Klikk to punkter i kartet for å dele valgt område."
              >
                <Scissors className="h-4 w-4" />
              </HoverActionButton>
            </div>
            {resolveMode ? (
              <div className="absolute left-3 top-[4.7rem] z-[690] max-w-sm rounded-2xl bg-fb-surface-page/96 px-3 py-2 backdrop-blur">
                <p className="text-xs font-medium text-fb-text-primary">Nytt område er aktivt</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk lenger inn i området du vil hente inn. Hvis ingenting treffer, får du beskjed og kan prøve på nytt.
                </p>
              </div>
            ) : null}
            {launchMode ? (
              <div className="absolute left-3 top-[4.7rem] z-[690] max-w-sm rounded-2xl bg-fb-surface-page/96 px-3 py-2 backdrop-blur">
                <p className="text-xs font-medium text-fb-text-primary">Startpunkt er aktivt</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk i kartet der du vil at drona skal starte oppdraget.
                </p>
              </div>
            ) : null}
            {landingMode ? (
              <div className="absolute left-3 top-[4.7rem] z-[690] max-w-sm rounded-2xl bg-fb-surface-page/96 px-3 py-2 backdrop-blur">
                <p className="text-xs font-medium text-fb-text-primary">Landingspunkt er aktivt</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk i kartet der du vil at drona skal avslutte oppdraget.
                </p>
              </div>
            ) : null}
            {noGoMode ? (
              <div className="absolute left-3 top-[4.7rem] z-[690] max-w-sm rounded-2xl bg-fb-surface-page/96 px-3 py-2 backdrop-blur">
                <p className="text-xs font-medium text-fb-text-primary">Hinder er aktivt</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk i kartet for å legge inn en rektangulær no-go sone. Dra i håndtakene for å flytte eller justere den.
                </p>
              </div>
            ) : null}
            <PlanningMap
              units={units}
              missions={selectedUnitMission ? [selectedUnitMission] : selectedUnit ? [] : activeMission ? [activeMission] : []}
              previewMission={preview}
              previewPending={previewPending}
              playbackActive={playbackActive}
              playbackIndex={playbackIndex}
              playbackFootprint={playbackFootprint}
              previewSuggestion={previewSuggestion}
              suggestionFocusToken={suggestionFocusToken}
              activeMissionId={selectedUnitMission?.id ?? (selectedUnit ? null : activeMissionId)}
              missionFocusToken={missionFocusToken}
              selectedUnitId={selectedUnitId}
              editMode={editMode}
              resolveOnMapClick={resolveMode}
              splitMode={splitMode}
              launchMode={launchMode}
              landingMode={landingMode}
              noGoMode={noGoMode}
              splitPoints={splitPoints}
              launchPoint={parameters.launch_point}
              landingPoint={parameters.landing_point}
              noGoBuffers={parameters.no_go_buffers}
              selectedNoGoBufferId={selectedNoGoBufferId}
              baseMapStyle={baseMapStyle}
              showZoomControls={false}
              mapGrayscale={mapGrayscale}
              mapVintage={mapVintage}
              onSelectUnit={handleSelectUnit}
              onResolvePoint={handleResolvePoint}
              onAddSplitPoint={handleAddSplitPoint}
              onSetLaunchPoint={handleSetLaunchPoint}
              onSetLandingPoint={handleSetLandingPoint}
              onAddNoGoBuffer={handleAddNoGoBuffer}
              onSelectNoGoBuffer={setSelectedNoGoBufferId}
              onMoveNoGoBuffer={(bufferId, center) => handleUpdateNoGoBufferSize(bufferId, { center })}
              onResizeNoGoBuffer={(bufferId, widthM, heightM) =>
                handleUpdateNoGoBufferSize(bufferId, { width_m: widthM, height_m: heightM })
              }
              onUnitGeometryChange={(geometry) => void handleUpdateSelectedFieldGeometry(geometry)}
            />
          </div>

          <div className="min-h-0 overflow-y-auto border-l border-fb-border-subtle/60 px-4 py-4">
            {selectedUnit ? (
              <div className="space-y-5">
                <div className="space-y-1">
                  <p className="text-sm font-semibold text-fb-text-primary">{selectedUnit.name}</p>
                  <p className="text-sm text-fb-text-secondary">
                    {(propertyLabelById.get(selectedUnit.property_id) ?? selectedUnit.source_field_name)} · {formatArea(selectedUnit.area_ha)}
                  </p>
                  <div className="mt-3 rounded-xl bg-fb-surface-ghost px-3 py-2">
                    <p className="text-xs font-medium text-fb-text-primary">
                      Kilde: {sourceLabel(selectedUnit.source_field_source, selectedUnit.source_field_provenance)}
                    </p>
                    {sourceDetailParts(selectedUnit.source_field_provenance).length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                        {sourceDetailParts(selectedUnit.source_field_provenance).join(" · ")}
                      </p>
                    ) : null}
                    <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                      Teiggrensen kan korrigeres manuelt i kartet dersom kildegrunnlaget ikke stemmer med faktisk drift.
                    </p>
                  </div>
                  {selectedUnit.latest_duration_status ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className={cn("text-xs font-medium", durationTone(selectedUnit.latest_duration_status))}>
                        {missionStatusLabel(selectedUnit.latest_duration_status)}
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-2xl bg-fb-surface-ghost px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <ClipboardList className="h-4 w-4 shrink-0 text-[color:var(--fb-season-solid)]" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-fb-text-primary">Feltoppgaver</p>
                        <p className="mt-1 text-xs text-fb-text-secondary">
                          Funn med posisjon og status for dette området.
                        </p>
                      </div>
                    </div>
                    <span className="rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-fb-text-secondary">
                      {scoutingTasks.length}
                    </span>
                  </div>
                  <p className="sr-only" aria-live="polite">
                    {scoutingStatusText}
                  </p>

                  <div className="mt-3 divide-y divide-fb-border-subtle">
                    {scoutingTasks.length === 0 ? (
                      <p className="py-3 text-xs leading-5 text-fb-text-secondary">
                        Ingen feltoppgaver ennå. Lagre første funn når du ser noe som må sjekkes i felt.
                      </p>
                    ) : (
                      scoutingTasks.slice(0, 5).map((task) => (
                        <div key={task.id} className="py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-fb-text-primary">{task.title}</p>
                              <p className="mt-1 text-xs text-fb-text-secondary">
                                {scoutingStatusLabel(task.status)} ·{" "}
                                <span className={cn("font-medium", scoutingPriorityTone(task.priority))}>
                                  {scoutingPriorityLabel(task.priority)}
                                </span>
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant={task.status === "done" ? "outline" : "ghost"}
                              onClick={() => void handlePatchScoutingTaskStatus(task, task.status === "done" ? "open" : "done")}
                              loading={scoutingPatchBusyId === task.id}
                              loadingLabel="Oppdaterer"
                              disabled={!canEdit}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {task.status === "done" ? "Åpne" : "Ferdig"}
                            </Button>
                          </div>
                          {task.notes ? <p className="mt-2 text-xs leading-5 text-fb-text-secondary">{task.notes}</p> : null}
                          <p className="mt-2 text-[11px] text-fb-text-secondary">
                            {task.position.lat.toFixed(5)}, {task.position.lng.toFixed(5)}
                          </p>
                        </div>
                      ))
                    )}
                  </div>

                  {canEdit ? (
                    <div className="mt-3 space-y-2 border-t border-fb-border-subtle pt-3">
                      <label className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Nytt funn</span>
                        <input
                          type="text"
                          value={scoutingDraft.title}
                          onChange={(event) =>
                            setScoutingDraft((current) => ({
                              ...current,
                              title: event.target.value,
                            }))
                          }
                          placeholder={`Funn i ${selectedUnit.name}`}
                          className="w-full rounded-xl bg-white/75 px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                        />
                      </label>
                      <textarea
                        value={scoutingDraft.notes}
                        onChange={(event) =>
                          setScoutingDraft((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                        placeholder="Kort notat, for eksempel ugras, kjørespor, vann eller behov for nytt bilde."
                        className="min-h-[4.5rem] w-full rounded-xl bg-white/75 px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors placeholder:text-fb-text-secondary focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Lat</span>
                          <input
                            type="number"
                            step="0.000001"
                            value={scoutingDraft.lat}
                            onChange={(event) =>
                              setScoutingDraft((current) => ({
                                ...current,
                                lat: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl bg-white/75 px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Lng</span>
                          <input
                            type="number"
                            step="0.000001"
                            value={scoutingDraft.lng}
                            onChange={(event) =>
                              setScoutingDraft((current) => ({
                                ...current,
                                lng: event.target.value,
                              }))
                            }
                            className="w-full rounded-xl bg-white/75 px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                          />
                        </label>
                      </div>
                      <div className="flex items-center gap-2">
                        <select
                          value={scoutingDraft.priority}
                          onChange={(event) =>
                            setScoutingDraft((current) => ({
                              ...current,
                              priority: event.target.value as ScoutingTaskPriority,
                            }))
                          }
                          className="min-w-0 flex-1 rounded-xl bg-white/75 px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                        >
                          <option value="low">Lav prioritet</option>
                          <option value="normal">Normal prioritet</option>
                          <option value="high">Høy prioritet</option>
                        </select>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void handleCreateScoutingTask()}
                          loading={scoutingBusy}
                          loadingLabel="Lagrer funn"
                        >
                          <MapPin className="h-3.5 w-3.5" />
                          Lagre
                        </Button>
                      </div>
                      {scoutingStatusText ? <p className="text-xs leading-5 text-fb-text-secondary">{scoutingStatusText}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Plannavn</span>
                    <input
                      type="text"
                      value={missionName}
                      onChange={(event) => setMissionName(event.target.value)}
                      disabled={!canEdit}
                      placeholder={selectedUnit.name}
                      className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Droneprofil</span>
                    <select
                      value={selectedDroneProfileId}
                      onChange={(event) => {
                        setSelectedDroneProfileId(event.target.value);
                        setParameters((current) =>
                          syncParametersWithSuggestedSpacing(
                            current,
                            profiles.find((profile) => profile.id === event.target.value) ?? null,
                          ),
                        );
                      }}
                      disabled={!canEdit}
                      className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedDroneProfile && selectedDroneProfile.camera_presets.length > 1 ? (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Kamera</span>
                      <select
                        value={selectedCameraPreset?.id ?? ""}
                        onChange={(event) => {
                          const nextPresetId = event.target.value || null;
                          setParameters((current) =>
                            syncParametersWithSuggestedSpacing(
                              {
                                ...current,
                                camera_preset_id: nextPresetId,
                              },
                              selectedDroneProfile,
                            ),
                          );
                        }}
                        disabled={!canEdit}
                        className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                      >
                        {selectedDroneProfile.camera_presets.map((preset) => (
                          <option key={preset.id} value={preset.id}>
                            {preset.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}

                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["altitude_m", "Høyde", 1, 500],
                      ["route_angle_deg", "Vinkel", 0, 180],
                    ] as const).map(([key, label, min, max]) => (
                      <label key={key} className="block">
                        <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">{label}</span>
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step="1"
                          value={parameters[key]}
                          onChange={(event) => {
                            const nextValue = Number(event.target.value) || parameters[key];
                            setParameters((current) => ({
                              ...(key === "altitude_m"
                                ? syncParametersWithSuggestedSpacing(
                                    {
                                      ...current,
                                      [key]: nextValue,
                                    },
                                    selectedDroneProfile,
                                  )
                                : {
                                    ...current,
                                    [key]: nextValue,
                                  }),
                            }));
                          }}
                          disabled={!canEdit}
                          className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                        />
                      </label>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Terreng</p>
                      <div className="flex items-center gap-1 rounded-full bg-fb-surface-ghost p-1">
                        {([
                          ["flat", "Flat"],
                          ["dem_agl", "Følg terreng"],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                              parameters.terrain_mode === mode
                                ? "bg-fb-text-primary text-white"
                                : "text-fb-text-secondary hover:text-fb-text-primary",
                            )}
                            onClick={() =>
                              setParameters((current) => ({
                                ...current,
                                terrain_mode: mode,
                              }))
                            }
                            disabled={!canEdit}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {parameters.terrain_mode === "dem_agl" ? (
                      <p className="text-xs text-fb-text-secondary">Høyde holdes over terrenget langs ruta.</p>
                    ) : null}
                    {parameters.terrain_mode === "dem_agl" && !parameters.launch_point ? (
                      <p className="text-xs text-fb-text-secondary">Sett gjerne startpunkt før eksport, så blir terrengreferansen tydelig.</p>
                    ) : null}
                    {terrainSummary?.min_terrain_elevation_m != null && terrainSummary?.max_terrain_elevation_m != null ? (
                      <p className="text-xs text-fb-text-secondary">
                        Terrengspenn: {(terrainSummary.max_terrain_elevation_m - terrainSummary.min_terrain_elevation_m).toFixed(1)} m
                        {terrainSummary.terrain_mode === "dem_agl" &&
                        terrainSummary.min_relative_waypoint_height_m != null &&
                        terrainSummary.max_relative_waypoint_height_m != null
                          ? ` · rutehøyde ${terrainSummary.min_relative_waypoint_height_m.toFixed(1)}–${terrainSummary.max_relative_waypoint_height_m.toFixed(1)} m`
                          : ""}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Avstander</p>
                      <span className="rounded-full bg-fb-text-primary px-2.5 py-1 text-xs font-medium text-white">Auto</span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {([
                        ["line_spacing_m", "Linjeavstand"],
                        ["waypoint_spacing_m", "Waypoint"],
                      ] as const).map(([key, label]) => (
                        <div key={key} className="block">
                          <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">{label}</span>
                          <div className="w-full rounded-xl bg-white/65 px-3 py-2 text-sm text-fb-text-primary">
                            {formatMeters(parameters[key])}
                          </div>
                        </div>
                      ))}
                    </div>

                    {suggestedSpacing ? (
                      <p className="text-xs text-fb-text-secondary">
                        {`${formatMeters(suggestedSpacing.line_spacing_m)} linje · ${formatMeters(suggestedSpacing.waypoint_spacing_m)} waypoint`}
                        {selectedCameraPreset ? ` · ${selectedCameraPreset.name}` : ""}
                        {suggestedSpacing.recommended_ground_speed_mps
                          ? ` · ${suggestedSpacing.recommended_ground_speed_mps.toFixed(1)} m/s`
                          : ""}
                      </p>
                    ) : null}
                    {capturePoints.length > 0 ? (
                      <p className="text-xs text-fb-text-secondary">
                        <Camera className="mr-1 inline h-3.5 w-3.5 align-[-0.12rem]" />
                        Dottene er beregnede bildepunkt. Preview viser kameraflaten ved hvert opptak.
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors",
                          launchMode ? "bg-fb-accent-primary text-white" : "bg-fb-surface-ghost text-fb-text-primary hover:bg-white",
                        )}
                        onClick={() => setToolMode((current) => (current === "launch" ? "select" : "launch"))}
                        disabled={!canEdit}
                      >
                        {parameters.launch_point ? "Flytt startpunkt" : "Sett startpunkt"}
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors",
                          landingMode ? "bg-fb-accent-primary text-white" : "bg-fb-surface-ghost text-fb-text-primary hover:bg-white",
                        )}
                        onClick={() => setToolMode((current) => (current === "landing" ? "select" : "landing"))}
                        disabled={!canEdit}
                      >
                        {parameters.landing_point ? "Flytt landingspunkt" : "Sett landingspunkt"}
                      </button>
                    </div>
                    <button
                      type="button"
                      className={cn(
                        "rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors",
                        noGoMode ? "bg-fb-accent-primary text-white" : "bg-fb-surface-ghost text-fb-text-primary hover:bg-white",
                      )}
                      onClick={() => setToolMode((current) => (current === "no_go" ? "select" : "no_go"))}
                      disabled={!canEdit}
                    >
                      Legg til hinder
                    </button>
                    {parameters.launch_point ? (
                      <button
                        type="button"
                        className="rounded-xl bg-fb-surface-ghost px-3 py-2 text-left text-xs font-medium text-fb-text-primary transition-colors hover:bg-white"
                        onClick={handleCopyLaunchPointToLanding}
                        disabled={!canEdit}
                      >
                        {parameters.landing_point &&
                        parameters.landing_point.lat === parameters.launch_point.lat &&
                        parameters.landing_point.lng === parameters.launch_point.lng
                          ? "Landing følger startpunkt"
                          : "Bruk startpunkt som landing"}
                      </button>
                    ) : null}
                    {parameters.launch_point ? (
                      <p className="text-xs text-fb-text-secondary">
                        Startpunkt: {parameters.launch_point.lat.toFixed(5)}, {parameters.launch_point.lng.toFixed(5)}
                      </p>
                    ) : null}
                    {parameters.landing_point ? (
                      <p className="text-xs text-fb-text-secondary">
                        Landingspunkt:{" "}
                        {parameters.launch_point &&
                        parameters.landing_point.lat === parameters.launch_point.lat &&
                        parameters.landing_point.lng === parameters.launch_point.lng
                          ? "Samme som startpunkt"
                          : `${parameters.landing_point.lat.toFixed(5)}, ${parameters.landing_point.lng.toFixed(5)}`}
                      </p>
                    ) : null}
                    {parameters.no_go_buffers.length > 0 ? (
                      <div className="space-y-2">
                        <div className="grid grid-cols-[minmax(0,1fr),4.75rem,4.75rem,auto] items-center gap-2 px-2 text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">
                          <span>Hinder</span>
                          <span>Bredde</span>
                          <span>Høyde</span>
                          <span></span>
                        </div>
                        {parameters.no_go_buffers.map((buffer, index) => (
                          <div
                            key={buffer.id ?? index}
                            className={cn(
                              "grid grid-cols-[minmax(0,1fr),4.75rem,4.75rem,auto] items-center gap-2 rounded-xl px-2 py-2 transition-colors",
                              selectedNoGoBufferId === buffer.id ? "bg-fb-surface-ghost" : "",
                            )}
                            onClick={() => setSelectedNoGoBufferId(buffer.id)}
                          >
                            <button type="button" className="min-w-0 text-left">
                              <p className="truncate text-xs font-medium text-fb-text-primary">
                                {buffer.name || `Hinder ${index + 1}`}
                              </p>
                              <p className="text-[11px] text-fb-text-secondary">
                                {buffer.center.lat.toFixed(5)}, {buffer.center.lng.toFixed(5)}
                              </p>
                            </button>
                            <input
                              type="number"
                              min={6}
                              max={300}
                              step="1"
                              value={buffer.width_m}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                handleUpdateNoGoBufferSize(buffer.id, {
                                  width_m: Number(event.target.value) || buffer.width_m,
                                })
                              }
                              disabled={!canEdit}
                              className="w-full rounded-xl bg-fb-surface-ghost px-2 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                            />
                            <input
                              type="number"
                              min={6}
                              max={300}
                              step="1"
                              value={buffer.height_m}
                              onClick={(event) => event.stopPropagation()}
                              onChange={(event) =>
                                handleUpdateNoGoBufferSize(buffer.id, {
                                  height_m: Number(event.target.value) || buffer.height_m,
                                })
                              }
                              disabled={!canEdit}
                              className="w-full rounded-xl bg-fb-surface-ghost px-2 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                            />
                            <button
                              type="button"
                              className="rounded-xl bg-fb-surface-ghost px-2.5 py-2 text-xs font-medium text-fb-text-primary transition-colors hover:bg-white"
                              onClick={(event) => {
                                event.stopPropagation();
                                handleRemoveNoGoBuffer(buffer.id);
                              }}
                              disabled={!canEdit}
                            >
                              Fjern
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-2xl bg-fb-surface-ghost px-3 py-3">
                  <div className="flex items-center gap-2">
                    <TimerReset className="h-4 w-4 text-[color:var(--fb-season-solid)]" />
                    <p className="text-sm font-semibold text-fb-text-primary">Estimert flytid</p>
                  </div>
                  <p className={cn("mt-2 text-2xl font-semibold", durationTone(preview?.duration_status ?? null))}>
                    {formatDuration(preview?.estimated_duration_s ?? null)}
                  </p>
                  <p className="mt-1 text-xs text-fb-text-secondary">
                  {preview ? missionStatusLabel(preview.duration_status) : "Beregnes når området er klart."}
                  </p>
                  {suggestedSpacing?.recommended_ground_speed_mps ? (
                    <p className="mt-1 text-xs text-fb-text-secondary">
                      Beregnet ved {suggestedSpacing.recommended_ground_speed_mps.toFixed(1)} m/s opptaksfart.
                    </p>
                  ) : null}
                  {previewWarnings.length > 0 ? (
                    <p className="mt-2 text-xs text-fb-text-secondary">{previewWarnings.length} varsel i rutegrunnlaget.</p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <HoverActionButton
                    type="button"
                    className="w-full"
                    onClick={() => void handleCreateMission()}
                    disabled={!canSaveMission}
                    loading={createBusy}
                    loadingLabel={selectedUnitMission ? "Oppdaterer plan" : "Lagrer plan"}
                    help={saveMissionHelp}
                  >
                    <Plane className="h-4 w-4" />
                    {selectedUnitMission ? "Oppdater plan" : "Lagre plan"}
                  </HoverActionButton>
                  {selectedUnitMission ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <HoverActionButton
                          type="button"
                          variant="ghost"
                          onClick={() => onExportMission(selectedUnitMission.id)}
                          loading={missionExportBusyId === selectedUnitMission.id}
                          loadingLabel="Eksporterer"
                          disabled={!canEdit}
                          help="Eksporter planen for dette området."
                        >
                          <Download className="h-4 w-4" />
                          {selectedUnitMission.drone_profile_id === "dji-mini-4-pro" ? "Eksporter DJI Fly" : "Eksporter"}
                        </HoverActionButton>
                        <HoverActionButton
                          type="button"
                          variant="ghost"
                          onClick={() => onDeleteMission(selectedUnitMission.id)}
                          loading={missionDeleteBusyId === selectedUnitMission.id}
                          loadingLabel="Sletter"
                          disabled={!canEdit}
                          help="Slett den lagrede planen for dette området."
                        >
                          <Trash2 className="h-4 w-4" />
                          Slett plan
                        </HoverActionButton>
                      </div>
                      {selectedMissionExportHint ? (
                        <div className="rounded-xl bg-fb-surface-ghost px-3 py-2">
                          <p className="text-xs font-medium text-fb-text-primary">{selectedMissionExportHint.title}</p>
                          <p className="mt-1 text-xs leading-5 text-fb-text-secondary">{selectedMissionExportHint.body}</p>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="h-full min-h-[18rem]" />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
