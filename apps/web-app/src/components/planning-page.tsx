import type { ComponentProps } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, Scissors, TimerReset, Plane, RefreshCw, LocateFixed } from "lucide-react";

import { apiGet, apiPatch, apiPost, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PlanningMap } from "@/components/planning-map";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type {
  DroneProfile,
  DroneProfileListResponse,
  FlightMission,
  FlightMissionParameters,
  FlightMissionPreview,
  GeoPoint,
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
};

interface PlanningPageProps {
  property: Property | null;
  propertyLabel: string | null;
  canEdit: boolean;
  missions: FlightMission[];
  activeMissionId: number | null;
  missionFocusToken: number;
  missionExportBusyId: number | null;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showZoomControls: boolean;
  onSelectMission: (missionId: number | null) => void;
  onExportMission: (missionId: number) => void;
  onReloadMissions: () => Promise<unknown> | void;
}

interface HoverActionButtonProps extends ComponentProps<typeof Button> {
  help: string;
}

function HoverActionButton({ help, ...props }: HoverActionButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button {...props} />
      </TooltipTrigger>
      <TooltipContent>{help}</TooltipContent>
    </Tooltip>
  );
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

function durationTone(status: string | null): string {
  if (status === "over_limit") return "text-[color:var(--fb-accent-danger)]";
  if (status === "warning") return "text-[color:var(--fb-map-analysis-accent)]";
  return "text-[color:var(--fb-accent-emerald)]";
}

function missionStatusLabel(status: string | null): string {
  if (status === "over_limit") return "For lang";
  if (status === "warning") return "Nær grensen";
  if (status === "ok") return "Klar";
  return "Ikke planlagt";
}

function missionSummary(mission: FlightMission): string {
  const fields = Array.isArray(mission.fields) ? mission.fields : [];
  const warnings = Array.isArray(mission.warnings) ? mission.warnings : [];
  const routeDistanceM =
    typeof mission.export_manifest === "object" &&
    mission.export_manifest !== null &&
    typeof mission.export_manifest.summary === "object" &&
    mission.export_manifest.summary !== null &&
    typeof (mission.export_manifest.summary as { route_distance_m?: unknown }).route_distance_m === "number"
      ? ((mission.export_manifest.summary as { route_distance_m: number }).route_distance_m)
      : null;

  const parts = [`${fields.length} jord${fields.length === 1 ? "" : "er"}`];
  if (routeDistanceM != null && Number.isFinite(routeDistanceM)) {
    parts.push(`${routeDistanceM.toFixed(0)} m rute`);
  }
  if (typeof mission.estimated_duration_s === "number" && Number.isFinite(mission.estimated_duration_s)) {
    parts.push(`${Math.round(mission.estimated_duration_s / 60)} min flytid`);
  }
  if (warnings.length > 0) {
    parts.push(`${warnings.length} varsel${warnings.length === 1 ? "" : "er"}`);
  }
  return parts.join(" · ");
}

export function PlanningPage({
  property,
  propertyLabel,
  canEdit,
  missions,
  activeMissionId,
  missionFocusToken,
  missionExportBusyId,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showZoomControls,
  onSelectMission,
  onExportMission,
  onReloadMissions,
}: PlanningPageProps) {
  const [units, setUnits] = useState<PlanningUnit[]>([]);
  const [unitsStatus, setUnitsStatus] = useState("Planenheter lastes …");
  const [profiles, setProfiles] = useState<DroneProfile[]>([]);
  const [selectedDroneProfileId, setSelectedDroneProfileId] = useState<string>("");
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [selectedMissionUnitIds, setSelectedMissionUnitIds] = useState<number[]>([]);
  const [missionName, setMissionName] = useState("");
  const [parameters, setParameters] = useState<FlightMissionParameters>(DEFAULT_FLIGHT_MISSION_PARAMETERS);
  const [preview, setPreview] = useState<FlightMissionPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState("Velg minst én planenhet for å beregne flytid.");
  const [findMode, setFindMode] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [splitPoints, setSplitPoints] = useState<GeoPoint[]>([]);
  const [syncBusy, setSyncBusy] = useState(false);
  const [findBusy, setFindBusy] = useState(false);
  const [splitBusy, setSplitBusy] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);

  const selectedUnit = useMemo(
    () => units.find((item) => item.id === selectedUnitId) ?? null,
    [selectedUnitId, units],
  );
  const activeMission = useMemo(
    () => missions.find((item) => item.id === activeMissionId) ?? null,
    [activeMissionId, missions],
  );
  const previewFields = Array.isArray(preview?.fields) ? preview.fields : [];
  const previewWarnings = Array.isArray(preview?.warnings) ? preview.warnings : [];

  const loadProfiles = useCallback(async () => {
    const { data } = await apiGet<DroneProfileListResponse>("/api/v1/drone-profiles", { cache: false, dedupe: false });
    const nextProfiles = Array.isArray(data?.profiles) ? data.profiles : [];
    setProfiles(nextProfiles);
    setSelectedDroneProfileId((current) => current || nextProfiles[0]?.id || "");
  }, []);

  const loadUnits = useCallback(async () => {
    if (!property) {
      setUnits([]);
      setSelectedUnitId(null);
      setSelectedMissionUnitIds([]);
      setUnitsStatus("Velg en aktiv eiendom for å åpne planlegging.");
      return;
    }

    const endpoint = `/api/v1/planning/properties/${property.id}/${canEdit ? "sync" : "units"}`;
    setSyncBusy(canEdit);
    try {
      const response = canEdit
        ? await apiPost<PlanningUnitSyncResponse>(endpoint)
        : await apiGet<PlanningUnitListResponse>(endpoint, { cache: false, dedupe: false });
      const nextUnits = Array.isArray(response.data?.units) ? response.data.units : [];
      setUnits(nextUnits);
      setSelectedUnitId((current) => current ?? nextUnits[0]?.id ?? null);
      setSelectedMissionUnitIds((current) => {
        if (current.length > 0) {
          return current.filter((unitId) => nextUnits.some((item) => item.id === unitId));
        }
        return nextUnits[0] ? [nextUnits[0].id] : [];
      });
      setUnitsStatus(
        nextUnits.length === 0
          ? canEdit
            ? "Ingen aktive planenheter ennå. Synk for å hente jorder fra aktiv eiendom."
            : "Ingen aktive planenheter ennå. Logg inn som admin og bruk Synk for å hente jorder fra aktiv eiendom."
          : `${nextUnits.length} planenheter klare for deling og planlegging.`,
      );
    } catch (error) {
      const apiError = error as ApiError;
      setUnits([]);
      setSelectedUnitId(null);
      setSelectedMissionUnitIds([]);
      setUnitsStatus(`Kunne ikke laste planlegging: ${apiError.message}`);
    } finally {
      setSyncBusy(false);
    }
  }, [canEdit, property]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    setMissionName("");
    setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
    setPreview(null);
    setPreviewStatus("Velg minst én planenhet for å beregne flytid.");
    setFindMode(false);
    setSplitMode(false);
    setSplitPoints([]);
    void loadUnits();
  }, [loadUnits]);

  useEffect(() => {
    if (!property || selectedMissionUnitIds.length === 0 || !selectedDroneProfileId) {
      setPreview(null);
      setPreviewStatus("Velg minst én planenhet for å beregne flytid.");
      return;
    }

    let cancelled = false;
    setPreviewStatus("Beregner plan …");
    void apiPost<FlightMissionPreview>("/api/v1/flight-missions/preview", {
      name: missionName || undefined,
      planning_unit_ids: selectedMissionUnitIds,
      drone_profile_id: selectedDroneProfileId,
      parameters,
    })
      .then(({ data }) => {
        if (cancelled) return;
        setPreview(data);
        setPreviewStatus("Flyplan beregnet fra valgte planenheter.");
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
  }, [missionName, parameters, property, selectedDroneProfileId, selectedMissionUnitIds]);

  useEffect(() => {
    if (!activeMission) return;

    const missionUnitIds = (
      Array.isArray(activeMission.planning_unit_ids) && activeMission.planning_unit_ids.length > 0
        ? activeMission.planning_unit_ids
        : activeMission.fields
            .map((field) => field.planning_unit_id)
            .filter((unitId): unitId is number => typeof unitId === "number")
    ).filter((unitId, index, items) => items.indexOf(unitId) === index);

    if (missionUnitIds.length > 0) {
      setSelectedMissionUnitIds(missionUnitIds);
      setSelectedUnitId(missionUnitIds[0]);
    }
    setMissionName(activeMission.name ?? "");
    setSelectedDroneProfileId((current) => activeMission.drone_profile_id || current);
    setParameters(activeMission.parameters);
  }, [activeMission]);

  const handleToggleMissionUnit = useCallback((unitId: number) => {
    setSelectedMissionUnitIds((current) =>
      current.includes(unitId) ? current.filter((item) => item !== unitId) : [...current, unitId],
    );
  }, []);

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
              setSelectedMissionUnitIds((currentIds) => {
                const base = currentIds.filter((item) => item !== selectedUnit.id);
                return [...base, ...data.created_units.map((item) => item.id)];
              });
              setUnitsStatus("Planenheten ble delt i to nye deljorder.");
              setSplitMode(false);
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

  const handleResolvePoint = useCallback(
    async (point: GeoPoint) => {
      if (!property || !canEdit || findBusy || splitMode) return;
      setFindBusy(true);
      try {
        const { data } = await apiPost<PlanningPointResolveResponse>(
          `/api/v1/planning/properties/${property.id}/resolve-point`,
          { lat: point.lat, lng: point.lng, radius_m: 60 },
        );
        setUnits((currentUnits) => {
          const nextUnit = data.unit;
          const remaining = currentUnits.filter((item) => item.id !== nextUnit.id);
          return [nextUnit, ...remaining];
        });
        setSelectedUnitId(data.unit.id);
        setSelectedMissionUnitIds((current) => (current.includes(data.unit.id) ? current : [...current, data.unit.id]));
        setUnitsStatus(
          data.imported_field
            ? `Fant og importerte ${data.candidate_name ?? data.unit.name} fra ${data.matrikkelnummer ?? "aktiv eiendom"}.`
            : `Fant ${data.candidate_name ?? data.unit.name} og fokuserte den i planen.`,
        );
        setFindMode(false);
      } catch (error) {
        const apiError = error as ApiError;
        setUnitsStatus(`Kunne ikke finne jord fra punkt: ${apiError.message}`);
      } finally {
        setFindBusy(false);
      }
    },
    [canEdit, findBusy, property, splitMode],
  );

  const handleCreateMission = useCallback(async () => {
    if (!canEdit || selectedMissionUnitIds.length === 0) return;
    setCreateBusy(true);
    try {
      const payload = {
        name: missionName || undefined,
        planning_unit_ids: selectedMissionUnitIds,
        drone_profile_id: selectedDroneProfileId || undefined,
        parameters,
      };
      const response = activeMissionId
        ? await apiPatch<FlightMission>(`/api/v1/flight-missions/${activeMissionId}`, payload)
        : await apiPost<FlightMission>("/api/v1/flight-missions", payload);
      const savedMission = response.data;
      setPreview(savedMission);
      setUnitsStatus(
        activeMissionId
          ? `Oppdaterte ${savedMission.name} i planleggingen.`
          : `Lagret ${savedMission.name} som flyoppdrag.`,
      );
      await Promise.all([loadUnits(), onReloadMissions()]);
      onSelectMission(savedMission.id);
    } catch (error) {
      const apiError = error as ApiError;
      setUnitsStatus(`Kunne ikke ${activeMissionId ? "oppdatere" : "lagre"} plan: ${apiError.message}`);
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
    selectedMissionUnitIds,
  ]);

  const handleStartNewPlan = useCallback(() => {
    onSelectMission(null);
    setMissionName("");
    setParameters(DEFAULT_FLIGHT_MISSION_PARAMETERS);
    setPreview(null);
    setPreviewStatus("Velg minst én planenhet for å beregne flytid.");
  }, [onSelectMission]);

  return (
    <div className="grid h-full min-h-0 gap-4 p-3 md:grid-cols-[22rem,minmax(0,1fr),22rem] md:p-4">
      <div className="flex min-h-0 flex-col gap-4">
        <section className="min-h-0 overflow-hidden rounded-[28px] border border-fb-border-subtle bg-fb-surface-page shadow-fb-floating">
          <div className="border-b border-fb-border-subtle px-4 py-4">
            <p className="text-[11px] uppercase tracking-[0.12em] text-fb-text-secondary">Planenheter</p>
            <h2 className="mt-1 text-lg font-semibold text-fb-text-primary">{propertyLabel ?? "Ingen aktiv eiendom"}</h2>
            <p className="mt-2 text-sm leading-6 text-fb-text-secondary">{unitsStatus}</p>
          </div>
          <div className="space-y-2 overflow-y-auto px-3 py-3">
            {units.map((unit) => {
              const active = unit.id === selectedUnitId;
              const included = selectedMissionUnitIds.includes(unit.id);
              return (
                <div
                  key={unit.id}
                  className={cn(
                    "rounded-2xl border px-3 py-3 transition-colors",
                    active ? "border-fb-border-strong bg-fb-surface-ghost" : "border-fb-border-subtle bg-fb-surface-page",
                  )}
                >
                  <button type="button" className="w-full text-left" onClick={() => setSelectedUnitId(unit.id)}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-fb-text-primary">{unit.name}</p>
                        <p className="mt-1 text-xs text-fb-text-secondary">{unit.source_field_name} · {formatArea(unit.area_ha)}</p>
                      </div>
                      <span className={cn("text-xs font-medium", durationTone(unit.latest_duration_status))}>
                        {missionStatusLabel(unit.latest_duration_status)}
                      </span>
                    </div>
                  </button>
                  <label className="mt-3 flex items-center gap-2 text-xs text-fb-text-secondary">
                    <input type="checkbox" checked={included} onChange={() => handleToggleMissionUnit(unit.id)} />
                    Ta med i plan
                  </label>
                </div>
              );
            })}
            {units.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-fb-border-strong bg-fb-surface-ghost px-3 py-4 text-sm text-fb-text-secondary">
                Ingen aktive planenheter ennå.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <section className="overflow-hidden rounded-[28px] border border-fb-border-subtle bg-fb-surface-page shadow-fb-floating">
        <div className="flex items-center justify-between border-b border-fb-border-subtle px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-fb-text-primary">Kart og deling</p>
            <p className="text-xs text-fb-text-secondary">
              {splitMode
                ? "Klikk to steder i kartet for å dele valgt jord."
                : findMode
                  ? "Klikk et sted i kartet for å finne riktig jord automatisk."
                  : "Velg en planenhet i listen for å fokusere den."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <HoverActionButton
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadUnits()}
              loading={syncBusy}
              loadingLabel="Synker"
              help={
                canEdit
                  ? "Hent bondens jorder fra aktiv eiendom og oppdater listen."
                  : "Oppdater listen over planenheter som allerede er lagt inn. Admin trengs for å hente nye jorder."
              }
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Synk
            </HoverActionButton>
            <HoverActionButton
              type="button"
              size="sm"
              variant={findMode ? "default" : "outline"}
              onClick={() => {
                setFindMode((current) => !current);
                setSplitMode(false);
                setSplitPoints([]);
              }}
              disabled={!canEdit}
              loading={findBusy}
              loadingLabel="Leter"
              help="Klikk deretter i kartet for å finne riktig jord automatisk."
            >
              <LocateFixed className="h-3.5 w-3.5" />
              Finn jord
            </HoverActionButton>
            <HoverActionButton
              type="button"
              size="sm"
              variant={splitMode ? "default" : "outline"}
              onClick={() => {
                setSplitMode((current) => !current);
                setFindMode(false);
                setSplitPoints([]);
              }}
              disabled={!canEdit || !selectedUnit}
              loading={splitBusy}
              loadingLabel="Deler"
              help="Klikk to punkter i kartet for å dele valgt jord i to."
            >
              <Scissors className="h-3.5 w-3.5" />
              Del jord
            </HoverActionButton>
          </div>
        </div>
        <div className="h-[min(70vh,48rem)]">
          <PlanningMap
            units={units}
            missions={missions}
            activeMissionId={activeMissionId}
            missionFocusToken={missionFocusToken}
            selectedUnitId={selectedUnitId}
            selectedMissionUnitIds={selectedMissionUnitIds}
            findMode={findMode}
            splitMode={splitMode}
            splitPoints={splitPoints}
            baseMapStyle={baseMapStyle}
            showZoomControls={showZoomControls}
            mapGrayscale={mapGrayscale}
            mapVintage={mapVintage}
            onSelectUnit={setSelectedUnitId}
            onResolvePoint={handleResolvePoint}
            onAddSplitPoint={handleAddSplitPoint}
          />
        </div>
      </section>

      <section className="overflow-y-auto rounded-[28px] border border-fb-border-subtle bg-fb-surface-page shadow-fb-floating">
        <div className="border-b border-fb-border-subtle px-4 py-4">
          <p className="text-sm font-semibold text-fb-text-primary">Plan og flytid</p>
          <p className="mt-1 text-sm text-fb-text-secondary">{previewStatus}</p>
        </div>
        <div className="space-y-5 px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <HoverActionButton
              type="button"
              size="sm"
              variant={activeMission ? "outline" : "default"}
              onClick={handleStartNewPlan}
              help="Tøm valgt oppdrag og start en ny plan med jordene du haker av til venstre."
            >
              Ny plan
            </HoverActionButton>
            {activeMission ? (
              <span className="text-xs text-fb-text-secondary">
                Redigerer nå <strong className="text-fb-text-primary">{activeMission.name}</strong>.
              </span>
            ) : (
              <span className="text-xs text-fb-text-secondary">Velg et lagret oppdrag under for å redigere det.</span>
            )}
          </div>

          <div className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Valgt deljord</p>
            <p className="mt-1 text-sm font-semibold text-fb-text-primary">{selectedUnit?.name ?? "Ingen valgt"}</p>
            <p className="mt-1 text-xs text-fb-text-secondary">
              {selectedUnit ? `${selectedUnit.source_field_name} · ${formatArea(selectedUnit.area_ha)}` : "Velg en planenhet fra listen."}
            </p>
          </div>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Oppdragsnavn</span>
            <input
              type="text"
              value={missionName}
              onChange={(event) => setMissionName(event.target.value)}
              placeholder="Plan vår 2026"
              className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Droneprofil</span>
            <select
              value={selectedDroneProfileId}
              onChange={(event) => setSelectedDroneProfileId(event.target.value)}
              className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
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
              ["route_angle_deg", "Rutevinkel", 0, 180],
              ["line_spacing_m", "Linjeavstand", 1, 200],
              ["waypoint_spacing_m", "Waypoint-avstand", 1, 200],
            ] as const).map(([key, label, min, max]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">{label}</span>
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="1"
                  value={parameters[key]}
                  onChange={(event) =>
                    setParameters((current) => ({
                      ...current,
                      [key]: Number(event.target.value) || current[key],
                    }))
                  }
                  className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                />
              </label>
            ))}
          </div>

          <div className="rounded-2xl border border-fb-border-strong bg-[color:color-mix(in_srgb,var(--fb-season-solid)_6%,white)] px-3 py-3">
            <div className="flex items-center gap-2">
              <TimerReset className="h-4 w-4 text-[color:var(--fb-season-solid)]" />
              <p className="text-sm font-semibold text-fb-text-primary">Estimert flytid</p>
            </div>
            <p className={cn("mt-2 text-2xl font-semibold", durationTone(preview?.duration_status ?? null))}>
              {formatDuration(preview?.estimated_duration_s ?? null)}
            </p>
            <p className="mt-1 text-xs text-fb-text-secondary">
              {preview ? `${missionStatusLabel(preview.duration_status)} · ${previewFields.length} deljord i planen` : "Beregnes når planen kan bygges."}
            </p>
            {previewWarnings.length > 0 ? (
              <div className="mt-3 rounded-xl bg-fb-surface-page px-3 py-2 text-xs text-fb-text-secondary">
                {previewWarnings.length} varsel i rutegrunnlaget.
              </div>
            ) : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-3">
            <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Valgte planenheter</p>
            {selectedMissionUnitIds.length === 0 ? (
              <p className="text-sm text-fb-text-secondary">Ingen deljorder valgt ennå.</p>
            ) : (
              selectedMissionUnitIds.map((unitId) => {
                const unit = units.find((item) => item.id === unitId);
                if (!unit) return null;
                return (
                  <div key={unit.id} className="flex items-center justify-between gap-3 rounded-xl bg-fb-surface-page px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-fb-text-primary">{unit.name}</p>
                      <p className="text-xs text-fb-text-secondary">{formatArea(unit.area_ha)}</p>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-[color:var(--fb-accent-emerald)]" />
                  </div>
                );
              })
            )}
          </div>

          <HoverActionButton
            type="button"
            className="w-full"
            onClick={() => void handleCreateMission()}
            disabled={!canEdit || selectedMissionUnitIds.length === 0}
            loading={createBusy}
            loadingLabel={activeMission ? "Oppdaterer plan" : "Lagrer plan"}
            help={
              activeMission
                ? "Lagre endringene tilbake til det oppdraget du redigerer nå."
                : "Lag et nytt flyoppdrag fra deljordene du har valgt."
            }
          >
            <Plane className="h-4 w-4" />
            {activeMission ? "Oppdater flyoppdrag" : "Lagre som flyoppdrag"}
          </HoverActionButton>
          <p className="text-xs text-fb-text-secondary">
            {activeMission
              ? "Du redigerer et lagret oppdrag. Trykk her for å lagre endringene tilbake på samme oppdrag."
              : "Denne knappen lager en ny plan av deljordene du har huket av i listen til venstre."}
          </p>

          <div className="space-y-2 rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Flyoppdrag</p>
                <p className="mt-1 text-sm font-semibold text-fb-text-primary">Lagrede planer og eksport</p>
              </div>
              <span className="text-xs text-fb-text-secondary">{missions.length} oppdrag</span>
            </div>
            {missions.length === 0 ? (
              <p className="text-sm text-fb-text-secondary">Ingen lagrede oppdrag ennå.</p>
            ) : (
              missions.slice(0, 6).map((mission) => (
                <div
                  key={mission.id}
                  className={cn(
                    "rounded-2xl border px-3 py-2.5",
                    activeMissionId === mission.id
                      ? "border-fb-border-strong bg-[color:color-mix(in_srgb,var(--fb-season-solid)_7%,white)]"
                      : "border-fb-border-subtle bg-fb-surface-page",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-fb-text-primary">{mission.name}</p>
                      <p className="mt-0.5 text-xs text-fb-text-secondary">{missionSummary(mission)}</p>
                    </div>
                    <span className={cn("text-xs font-medium", durationTone(mission.duration_status))}>
                      {missionStatusLabel(mission.duration_status)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <HoverActionButton
                      type="button"
                      size="sm"
                      variant={activeMissionId === mission.id ? "default" : "outline"}
                      onClick={() => onSelectMission(mission.id)}
                      help="Åpne dette oppdraget i planleggingen og last inn jordvalg, navn og parametre for videre redigering."
                    >
                      {activeMissionId === mission.id ? "Redigerer nå" : "Rediger i planlegging"}
                    </HoverActionButton>
                    <HoverActionButton
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onExportMission(mission.id)}
                      loading={missionExportBusyId === mission.id}
                      loadingLabel="Eksporterer"
                      disabled={!canEdit}
                      help="Last ned dette oppdraget som eksportpakke."
                    >
                      <Download className="h-3.5 w-3.5" />
                      Eksporter
                    </HoverActionButton>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
