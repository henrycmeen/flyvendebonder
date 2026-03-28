import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleOff, Download, MapPin, MousePointer2, PencilLine, Plane, Plus, RefreshCw, Scissors, Settings2, TimerReset, Trash2, Search } from "lucide-react";

import { apiDelete, apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlanningMap } from "@/components/planning-map";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  DroneProfile,
  DroneProfileListResponse,
  FieldCandidate,
  FieldCandidateListResponse,
  FieldPlotDeleteResponse,
  FieldPlot,
  FlightMission,
  FlightMissionParameters,
  FlightMissionPreview,
  GeoJSONPolygon,
  GeoPoint,
  NoGoBuffer,
  PlanningUnit,
  PlanningUnitListResponse,
  PlanningPointResolveResponse,
  PlanningUnitSplitResponse,
  PlanningUnitSyncResponse,
  Property,
} from "@/types";
import type { BaseMapStyle } from "@/lib/map-styles";

const DEFAULT_FLIGHT_MISSION_PARAMETERS: FlightMissionParameters = {
  altitude_m: 45,
  line_spacing_m: 18,
  waypoint_spacing_m: 18,
  route_angle_deg: 0,
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

function roundSpacing(value: number): number {
  return Math.max(1, Math.round(value * 10) / 10);
}

function suggestSpacing(
  profile: DroneProfile | null,
  altitudeM: number,
): { line_spacing_m: number; waypoint_spacing_m: number } | null {
  if (!profile || !Number.isFinite(altitudeM) || altitudeM <= 0) return null;
  const widthRatio = Number(profile.ground_footprint_width_ratio);
  const heightRatio = Number(profile.ground_footprint_height_ratio);
  const sideOverlap = Number(profile.target_side_overlap);
  const frontOverlap = Number(profile.target_front_overlap);
  if (
    !Number.isFinite(widthRatio) ||
    !Number.isFinite(heightRatio) ||
    !Number.isFinite(sideOverlap) ||
    !Number.isFinite(frontOverlap)
  ) {
    return null;
  }
  const footprintWidthM = altitudeM * widthRatio;
  const footprintHeightM = altitudeM * heightRatio;
  return {
    line_spacing_m: roundSpacing(footprintWidthM * (1 - sideOverlap)),
    waypoint_spacing_m: roundSpacing(footprintHeightM * (1 - frontOverlap)),
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

function classifyUnitBucket(unit: PlanningUnit, propertyLabel: string | undefined): UnitBucket {
  const haystack = [unit.name, unit.source_field_name, propertyLabel ?? ""].join(" ").toLocaleLowerCase("nb");
  if (haystack.includes("skog")) return "forest";
  if (haystack.includes("uavklart")) return "unknown";
  return "field";
}

function unitCountLabel(count: number): string {
  return count === 1 ? "1 jord klart for planlegging." : `${count} jorder klare for planlegging.`;
}

function normalizeMissionParameters(parameters: Partial<FlightMissionParameters> | null | undefined): FlightMissionParameters {
  return {
    ...DEFAULT_FLIGHT_MISSION_PARAMETERS,
    ...parameters,
    launch_point: parameters?.launch_point ?? null,
    landing_point: parameters?.landing_point ?? null,
    no_go_buffers: Array.isArray(parameters?.no_go_buffers) ? parameters.no_go_buffers : [],
  };
}

function createNoGoBuffer(point: GeoPoint): NoGoBuffer {
  return {
    id: `buffer-${Date.now()}-${Math.round(point.lat * 1000)}-${Math.round(point.lng * 1000)}`,
    name: null,
    center: point,
    radius_m: 25,
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
  const [profiles, setProfiles] = useState<DroneProfile[]>([]);
  const [suggestions, setSuggestions] = useState<PlanningSuggestion[]>([]);
  const [selectedDroneProfileId, setSelectedDroneProfileId] = useState<string>("");
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [selectedMissionUnitIds, setSelectedMissionUnitIds] = useState<number[]>([]);
  const [missionName, setMissionName] = useState("");
  const [parameters, setParameters] = useState<FlightMissionParameters>(DEFAULT_FLIGHT_MISSION_PARAMETERS);
  const [preview, setPreview] = useState<FlightMissionPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState("Velg ett jord for å beregne flytid.");
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
  const [spacingMode, setSpacingMode] = useState<"auto" | "manual">("auto");

  const selectedUnit = useMemo(
    () => units.find((item) => item.id === selectedUnitId) ?? null,
    [selectedUnitId, units],
  );
  const selectedDroneProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedDroneProfileId) ?? null,
    [profiles, selectedDroneProfileId],
  );
  const suggestedSpacing = useMemo(
    () => suggestSpacing(selectedDroneProfile, parameters.altitude_m),
    [parameters.altitude_m, selectedDroneProfile],
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
  const previewWarnings = Array.isArray(preview?.warnings) ? preview.warnings : [];
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
      const haystack = [candidate.name, candidate.property_label, candidate.land_use_label, candidate.ar5_class ?? ""]
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
      setSpacingMode("auto");
      setSelectedUnitId(unitId);
      setSelectedMissionUnitIds([unitId]);
      setSplitPoints([]);
      onSelectMission(unit?.latest_mission_id ?? null);
      if (!unit?.latest_mission_id) {
        setMissionName(unit?.name ? `Plan ${unit.name}` : "");
        setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
        setPreview(null);
        setPreviewStatus("Jord valgt. Juster innstillingene og lagre planen.");
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
              ? "Ingen jorder ennå. Trykk Nytt jord og klikk i kartet, eller hent eierjorder under Innstillinger."
              : "Ingen jorder lagt inn ennå."
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
          ? `Hentet ${createdCount} nye jord${createdCount === 1 ? "" : "er"} som utkast fra eier-eiendommene dine.`
          : nextUnits.length > 0
            ? "Alle eierjorder er allerede klare i listen."
            : "Fant ingen nye eierjorder å legge inn.",
      );
      setSettingsOpen(false);
      await loadSuggestions();
    } catch (error) {
      const apiError = error as ApiError;
      setUnitsStatus(`Kunne ikke hente eierjorder: ${apiError.message}`);
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
    setMissionName("");
    setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
    setPreview(null);
    setPreviewStatus("Velg eller opprett et jord for å begynne.");
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
      setPreview(null);
      setPreviewStatus("Velg ett jord for å beregne flytid.");
      return;
    }

    let cancelled = false;
    setPreviewStatus("Beregner plan …");
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
        setPreviewStatus("Flyplan beregnet fra valgt jord.");
      })
      .catch((error) => {
        if (cancelled) return;
        const apiError = error as ApiError;
        setPreview(null);
        setPreviewStatus(`Kunne ikke beregne plan: ${apiError.message}`);
      });

    return () => {
      cancelled = true;
    };
  }, [missionName, parameters, selectedDroneProfileId, selectedMissionUnitIds, selectedUnit]);

  useEffect(() => {
    if (!selectedUnit) {
      setMissionName("");
      setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
      setSpacingMode("auto");
      setPreview(null);
      setPreviewStatus("Velg eller opprett et jord for å begynne.");
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
        setSelectedMissionUnitIds([selectedUnit.id]);
        setMissionName(activeMission.name ?? selectedUnit.name);
        setSelectedDroneProfileId((current) => activeMission.drone_profile_id || current);
        setParameters(normalizeMissionParameters(activeMission.parameters));
        setSpacingMode("manual");
        setPreview(activeMission);
        setPreviewStatus("Plan lastet for valgt jord.");
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
    setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
    setSpacingMode("auto");
    setPreview(null);
    setPreviewStatus("Juster parametre og lagre plan for dette jordet.");
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
  }, [activeMission, selectedUnit]);

  useEffect(() => {
    if (spacingMode !== "auto" || !suggestedSpacing) return;
    setParameters((current) => {
      if (
        current.line_spacing_m === suggestedSpacing.line_spacing_m &&
        current.waypoint_spacing_m === suggestedSpacing.waypoint_spacing_m
      ) {
        return current;
      }
      return {
        ...current,
        line_spacing_m: suggestedSpacing.line_spacing_m,
        waypoint_spacing_m: suggestedSpacing.waypoint_spacing_m,
      };
    });
  }, [spacingMode, suggestedSpacing]);

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
    setParameters((current) => ({
      ...current,
      launch_point: point,
    }));
    setPreviewStatus("Startpunkt oppdatert.");
    setToolMode("select");
  }, []);

  const handleSetLandingPoint = useCallback((point: GeoPoint) => {
    setParameters((current) => ({
      ...current,
      landing_point: point,
    }));
    setPreviewStatus("Landingspunkt oppdatert.");
    setToolMode("select");
  }, []);

  const handleAddNoGoBuffer = useCallback((point: GeoPoint) => {
    const nextBuffer = createNoGoBuffer(point);
    setParameters((current) => ({
      ...current,
      no_go_buffers: [...current.no_go_buffers, nextBuffer],
    }));
    setPreviewStatus("La til hinderbuffer i rutegrunnlaget.");
  }, []);

  const handleUpdateNoGoBufferRadius = useCallback((bufferId: string | null, radiusM: number) => {
    if (!bufferId) return;
    setParameters((current) => ({
      ...current,
      no_go_buffers: current.no_go_buffers.map((buffer) =>
        buffer.id === bufferId
          ? {
              ...buffer,
              radius_m: Math.max(3, radiusM),
            }
          : buffer,
      ),
    }));
  }, []);

  const handleRemoveNoGoBuffer = useCallback((bufferId: string | null) => {
    if (!bufferId) return;
    setParameters((current) => ({
      ...current,
      no_go_buffers: current.no_go_buffers.filter((buffer) => buffer.id !== bufferId),
    }));
  }, []);

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
            ? `Fant og importerte ${data.candidate_name ?? data.unit.name} fra ${data.property_label ?? propertyLabelById.get(data.property_id) ?? data.matrikkelnummer ?? "teigen"}. Nytt jord er fortsatt aktivt.`
            : `Fant ${data.candidate_name ?? data.unit.name} og valgte den i planen. Nytt jord er fortsatt aktivt.`,
        );
        await loadSuggestions();
      } catch (error) {
        const apiError = error as ApiError;
        if (apiError.status === 404) {
          setUnitsStatus("Fant ingen teig der. Klikk lenger inn i teigen og prøv igjen.");
        } else {
          setUnitsStatus(`Kunne ikke finne jord fra kartklikk: ${apiError.message}`);
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
        });
        const syncResponse = await apiPost<PlanningUnitSyncResponse>(`/api/v1/planning/properties/${candidate.property_id}/sync`);
        const syncedUnits = Array.isArray(syncResponse.data?.units) ? syncResponse.data.units : [];
        const untouchedUnits = units.filter((item) => item.property_id !== candidate.property_id);
        const nextUnits = [...syncedUnits, ...untouchedUnits].sort(
          (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || b.id - a.id,
        );
        applyUnits(nextUnits, `${candidate.name} ble lagt inn som jordutkast.`);
        const createdUnit = nextUnits.find((item) => item.source_field_plot_id === createdField.data.id) ?? null;
        if (createdUnit) {
          setSelectedUnitId(createdUnit.id);
          setSelectedMissionUnitIds([createdUnit.id]);
          onSelectMission(createdUnit.latest_mission_id ?? null);
        }
        await loadSuggestions();
      } catch (error) {
        const apiError = error as ApiError;
        setUnitsStatus(`Kunne ikke opprette jord fra forslag: ${apiError.message}`);
      } finally {
        setSuggestionCreateKey(null);
      }
    },
    [applyUnits, canEdit, loadSuggestions, onSelectMission, units],
  );

  const handleCreateMission = useCallback(async () => {
    if (!canEdit || selectedMissionUnitIds.length === 0) return;
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
    canEdit,
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
      setFieldGeometryBusy(true);
      try {
        await apiPatch(`/api/v1/fields/${selectedUnit.source_field_plot_id}`, {
          geometry,
        });
        await loadUnits();
        setUnitsStatus(`Oppdaterte avgrensningen for ${selectedUnit.source_field_name}.`);
      } catch (error) {
        const apiError = error as ApiError;
        setUnitsStatus(`Kunne ikke oppdatere jordet: ${apiError.message}`);
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
      setUnitsStatus(`Kunne ikke slette jord: ${apiError.message}`);
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
    setSpacingMode("auto");
    setPreview(null);
    setPreviewStatus("Klikk på et jord i kartet for å lage et nytt jordutkast.");
    setUnitsStatus("Nytt jord er aktivt. Klikk lenger inn i jordet du vil hente inn som utkast.");
    setToolMode(canEdit ? "resolve" : "select");
    setSplitPoints([]);
    setSettingsOpen(false);
  }, [canEdit, onSelectMission]);

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
      setPreviewStatus("Forslag valgt. Se plasseringen i kartet før du eventuelt oppretter jordet.");
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
            <p className="pt-1 text-[11px] uppercase tracking-[0.12em] text-fb-text-secondary">Jorder</p>
            <div className="flex shrink-0 items-center gap-2">
              <HoverActionButton
                type="button"
                size="sm"
                variant="default"
                onClick={handleStartNewField}
                disabled={!canEdit || properties.length === 0}
                help="Start et nytt jord ved å klikke på jordet i kartet."
              >
                <Plus className="h-3.5 w-3.5" />
                Nytt jord
              </HoverActionButton>
              <HoverActionButton
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setSettingsOpen((current) => !current)}
                disabled={!canEdit || properties.length === 0}
                help="Åpne handlinger for å hente inn bondens jorder fra eiendommene du eier."
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
                loadingLabel="Henter jorder"
                help="Hent inn alle jordene du eier og legg dem i listen som utkast."
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Hent alle eierjorder
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
              placeholder="Filtrer jorder og forslag …"
              className="w-full rounded-xl bg-fb-surface-ghost px-9 py-2.5 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="divide-y divide-fb-border-subtle">
            <section className="px-4 py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Jorder</p>
                <span className="text-xs text-fb-text-secondary">{filteredUnits.length}</span>
              </div>
              {filteredUnits.length === 0 ? (
                <div className="px-1 py-4 text-sm text-fb-text-secondary">Ingen jorder ennå.</div>
              ) : (
                <div className="space-y-4">
                  {([
                    ["field", "Jord"],
                    ["forest", "Skog"],
                    ["unknown", "Uavklart"],
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
                    ["field", "Jord"],
                    ["forest", "Skog"],
                    ["unknown", "Uavklart"],
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
                        </div>
                        <span className="text-[11px] font-medium text-fb-text-secondary">Forslag</span>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <HoverActionButton
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => handlePreviewSuggestion(candidate, true)}
                          help="Vis hvor dette jordet ligger i kartet uten å opprette det."
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
                          help="Opprett dette jordet som utkast og åpne det i planleggingen."
                        >
                          Opprett jord
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
              <h2 className="mt-1 text-xl font-semibold text-fb-text-primary">
                {selectedUnit?.name ?? "Jord"}
              </h2>
              {selectedUnit ? <p className="mt-2 text-sm text-fb-text-secondary">{previewStatus}</p> : null}
            </div>
            {selectedUnit ? (
              <div className="flex flex-wrap gap-2">
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
                  loadingLabel="Lagrer jord"
                  help={
                    selectedUnit.parent_unit_id != null
                      ? "Finjustering med dragging er foreløpig bare tilgjengelig for hele jorder."
                      : "Dra i punktene i kartet for å justere jordgrensen."
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
                  help="Del jordet ved å klikke to punkter i kartet."
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
                  loadingLabel="Sletter jord"
                  help="Slett hele jordet permanent."
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Slett jord
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
                help="Velg et jord i kartet eller listen."
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
                help="Klikk i kartet for å lage et nytt jord fra kartdata."
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
                help="Dra i punktene rundt valgt jord for å justere grensen."
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
                help="Klikk to punkter i kartet for å dele valgt jord."
              >
                <Scissors className="h-4 w-4" />
              </HoverActionButton>
            </div>
            {resolveMode ? (
              <div className="absolute left-3 top-[4.7rem] z-[690] max-w-sm rounded-2xl bg-fb-surface-page/96 px-3 py-2 backdrop-blur">
                <p className="text-xs font-medium text-fb-text-primary">Nytt jord er aktivt</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk lenger inn i jordet du vil hente inn. Hvis ingenting treffer, får du beskjed og kan prøve på nytt.
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
                <p className="text-xs font-medium text-fb-text-primary">Hinderbuffer er aktiv</p>
                <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                  Klikk i kartet for å legge inn en no-go sone. Du kan justere radiusen i høyrepanelet etterpå.
                </p>
              </div>
            ) : null}
            <PlanningMap
              units={units}
              missions={selectedUnitMission ? [selectedUnitMission] : activeMission ? [activeMission] : []}
              previewSuggestion={previewSuggestion}
              suggestionFocusToken={suggestionFocusToken}
              activeMissionId={selectedUnitMission?.id ?? activeMissionId}
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
                  {selectedUnit.latest_duration_status ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className={cn("text-xs font-medium", durationTone(selectedUnit.latest_duration_status))}>
                        {missionStatusLabel(selectedUnit.latest_duration_status)}
                      </span>
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
                      placeholder={selectedUnit.name}
                      className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Droneprofil</span>
                    <select
                      value={selectedDroneProfileId}
                      onChange={(event) => setSelectedDroneProfileId(event.target.value)}
                      className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    {([
                      ["altitude_m", "Høyde", 1, 500],
                      ["route_angle_deg", "Vinkel", 0, 180],
                      ["line_spacing_m", "Linjeavstand", 1, 200],
                      ["waypoint_spacing_m", "Waypoint", 1, 200],
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
                            if (key === "line_spacing_m" || key === "waypoint_spacing_m") {
                              setSpacingMode("manual");
                            }
                            setParameters((current) => ({
                              ...current,
                              [key]: nextValue,
                            }));
                          }}
                          className="w-full rounded-xl bg-fb-surface-ghost px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                        />
                      </label>
                    ))}
                  </div>
                  {suggestedSpacing ? (
                    <div className="flex items-center justify-between gap-3 text-xs text-fb-text-secondary">
                      <p>
                        {spacingMode === "auto"
                          ? `Avstander følger høyde automatisk: ${suggestedSpacing.line_spacing_m} m linje, ${suggestedSpacing.waypoint_spacing_m} m waypoint.`
                          : `Anbefalt ved ${parameters.altitude_m} m: ${suggestedSpacing.line_spacing_m} m linje, ${suggestedSpacing.waypoint_spacing_m} m waypoint.`}
                      </p>
                      {spacingMode === "manual" ? (
                        <button
                          type="button"
                          className="shrink-0 rounded-full bg-fb-surface-ghost px-2.5 py-1 font-medium text-fb-text-primary transition-colors hover:bg-white"
                          onClick={() => setSpacingMode("auto")}
                        >
                          Bruk anbefalt
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="grid gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        className={cn(
                          "rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors",
                          launchMode ? "bg-fb-accent-primary text-white" : "bg-fb-surface-ghost text-fb-text-primary hover:bg-white",
                        )}
                        onClick={() => setToolMode((current) => (current === "launch" ? "select" : "launch"))}
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
                    >
                      Legg til hinderbuffer
                    </button>
                    {parameters.launch_point ? (
                      <p className="text-xs text-fb-text-secondary">
                        Startpunkt: {parameters.launch_point.lat.toFixed(5)}, {parameters.launch_point.lng.toFixed(5)}
                      </p>
                    ) : null}
                    {parameters.landing_point ? (
                      <p className="text-xs text-fb-text-secondary">
                        Landingspunkt: {parameters.landing_point.lat.toFixed(5)}, {parameters.landing_point.lng.toFixed(5)}
                      </p>
                    ) : null}
                    {parameters.no_go_buffers.length > 0 ? (
                      <div className="space-y-2">
                        {parameters.no_go_buffers.map((buffer, index) => (
                          <div key={buffer.id ?? index} className="grid grid-cols-[minmax(0,1fr),4.5rem,auto] items-center gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-fb-text-primary">
                                {buffer.name || `Hinderbuffer ${index + 1}`}
                              </p>
                              <p className="text-[11px] text-fb-text-secondary">
                                {buffer.center.lat.toFixed(5)}, {buffer.center.lng.toFixed(5)}
                              </p>
                            </div>
                            <input
                              type="number"
                              min={3}
                              max={300}
                              step="1"
                              value={buffer.radius_m}
                              onChange={(event) =>
                                handleUpdateNoGoBufferRadius(buffer.id, Number(event.target.value) || buffer.radius_m)
                              }
                              className="w-full rounded-xl bg-fb-surface-ghost px-2 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:bg-white focus:ring-1 focus:ring-fb-border-strong"
                            />
                            <button
                              type="button"
                              className="rounded-xl bg-fb-surface-ghost px-2.5 py-2 text-xs font-medium text-fb-text-primary transition-colors hover:bg-white"
                              onClick={() => handleRemoveNoGoBuffer(buffer.id)}
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
                    {preview ? missionStatusLabel(preview.duration_status) : "Beregnes når jordet er klart."}
                  </p>
                  {previewWarnings.length > 0 ? (
                    <p className="mt-2 text-xs text-fb-text-secondary">{previewWarnings.length} varsel i rutegrunnlaget.</p>
                  ) : null}
                </div>

                <div className="grid gap-2">
                  <HoverActionButton
                    type="button"
                    className="w-full"
                    onClick={() => void handleCreateMission()}
                    disabled={!canEdit || selectedMissionUnitIds.length === 0}
                    loading={createBusy}
                    loadingLabel={selectedUnitMission ? "Oppdaterer plan" : "Lagrer plan"}
                    help={selectedUnitMission ? "Oppdater planen som allerede er lagret for dette jordet." : "Lagre en ny plan for dette jordet."}
                  >
                    <Plane className="h-4 w-4" />
                    {selectedUnitMission ? "Oppdater plan" : "Lagre plan"}
                  </HoverActionButton>
                  {selectedUnitMission ? (
                    <div className="grid grid-cols-2 gap-2">
                      <HoverActionButton
                        type="button"
                        variant="ghost"
                        onClick={() => onExportMission(selectedUnitMission.id)}
                        loading={missionExportBusyId === selectedUnitMission.id}
                        loadingLabel="Eksporterer"
                        disabled={!canEdit}
                        help="Eksporter planen for dette jordet."
                      >
                        <Download className="h-4 w-4" />
                        Eksporter
                      </HoverActionButton>
                      <HoverActionButton
                        type="button"
                        variant="ghost"
                        onClick={() => onDeleteMission(selectedUnitMission.id)}
                        loading={missionDeleteBusyId === selectedUnitMission.id}
                        loadingLabel="Sletter"
                        disabled={!canEdit}
                        help="Slett den lagrede planen for dette jordet."
                      >
                        <Trash2 className="h-4 w-4" />
                        Slett plan
                      </HoverActionButton>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[18rem] items-center justify-center">
                <div className="max-w-sm text-center">
                  <p className="text-sm font-semibold text-fb-text-primary">
                    {toolMode === "resolve"
                      ? "Klikk på et jord i kartet"
                      : toolMode === "launch"
                        ? "Klikk i kartet for startpunkt"
                        : toolMode === "landing"
                          ? "Klikk i kartet for landingspunkt"
                          : toolMode === "no_go"
                            ? "Klikk i kartet for hinderbuffer"
                            : "Velg et jord i listen"}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-fb-text-secondary">
                    {toolMode === "resolve"
                      ? "Vi prøver å fylle jordet automatisk, så du kan finjustere det og lage plan."
                      : toolMode === "launch"
                        ? "Neste kartklikk blir brukt som startpunkt for ruten."
                        : toolMode === "landing"
                          ? "Neste kartklikk blir brukt som landingspunkt for ruten."
                          : toolMode === "no_go"
                            ? "Neste kartklikk legger inn en hinderbuffer som ruten skal unngå."
                            : "Når du velger et jord, får du opp kart, justering av grenser, droneprofil og estimert flytid her."}
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
