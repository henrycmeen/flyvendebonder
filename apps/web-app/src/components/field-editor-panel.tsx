import { Crosshair, Download, PencilLine, Plane, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FieldPlot, FieldPlotDraft, FlightMission, FlightMissionParameters } from "@/types";

interface FieldEditorPanelProps {
  propertyLabel: string | null;
  fieldStatus: string;
  missionStatus: string;
  canEdit: boolean;
  createMode: boolean;
  fieldPlots: FieldPlot[];
  activeFieldDraft: FieldPlotDraft | null;
  missionName: string;
  missionParameters: FlightMissionParameters;
  selectedMissionFieldIds: number[];
  missions: FlightMission[];
  activeMissionId: number | null;
  saveBusy: boolean;
  deleteBusy: boolean;
  missionCreateBusy: boolean;
  missionExportBusyId: number | null;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSelectField: (fieldId: number) => void;
  onChangeDraftName: (value: string) => void;
  onSaveDraft: () => void;
  onDiscardDraft: () => void;
  onDeleteDraft: () => void;
  onChangeMissionName: (value: string) => void;
  onChangeMissionParameter: (key: keyof FlightMissionParameters, value: string) => void;
  onToggleMissionField: (fieldId: number) => void;
  onCreateMission: () => void;
  onSelectMission: (missionId: number) => void;
  onExportMission: (missionId: number) => void;
}

function formatFieldArea(areaHa: number | null): string {
  if (areaHa == null || !Number.isFinite(areaHa)) {
    return "Ikke beregnet";
  }
  if (areaHa >= 10) {
    return `${areaHa.toFixed(1)} ha`;
  }
  return `${areaHa.toFixed(2)} ha`;
}

function missionSummary(mission: FlightMission): string {
  const routeDistanceM =
    typeof mission.export_manifest === "object" &&
    mission.export_manifest !== null &&
    typeof mission.export_manifest.summary === "object" &&
    mission.export_manifest.summary !== null &&
    typeof (mission.export_manifest.summary as { route_distance_m?: unknown }).route_distance_m === "number"
      ? ((mission.export_manifest.summary as { route_distance_m: number }).route_distance_m)
      : null;

  const parts = [`${mission.fields.length} jord${mission.fields.length === 1 ? "" : "er"}`];
  if (routeDistanceM != null && Number.isFinite(routeDistanceM)) {
    parts.push(`${routeDistanceM.toFixed(0)} m rute`);
  }
  if (typeof mission.estimated_duration_s === "number" && Number.isFinite(mission.estimated_duration_s)) {
    parts.push(`${Math.round(mission.estimated_duration_s / 60)} min flytid`);
  }
  if (mission.warnings.length > 0) {
    parts.push(`${mission.warnings.length} varsel${mission.warnings.length === 1 ? "" : "er"}`);
  }
  return parts.join(" · ");
}

export function FieldEditorPanel({
  propertyLabel,
  fieldStatus,
  missionStatus,
  canEdit,
  createMode,
  fieldPlots,
  activeFieldDraft,
  missionName,
  missionParameters,
  selectedMissionFieldIds,
  missions,
  activeMissionId,
  saveBusy,
  deleteBusy,
  missionCreateBusy,
  missionExportBusyId,
  onStartCreate,
  onCancelCreate,
  onSelectField,
  onChangeDraftName,
  onSaveDraft,
  onDiscardDraft,
  onDeleteDraft,
  onChangeMissionName,
  onChangeMissionParameter,
  onToggleMissionField,
  onCreateMission,
  onSelectMission,
  onExportMission,
}: FieldEditorPanelProps) {
  const hasActiveDraft = activeFieldDraft !== null;
  const activeFieldId = activeFieldDraft?.id ?? null;

  return (
    <div className="pointer-events-none absolute left-3 top-[4.6rem] z-[870] w-[min(24rem,calc(100vw-1.5rem))] sm:left-4 sm:top-4">
      <div className="fb-map-overlay-preview pointer-events-auto rounded-[24px] border border-fb-border-subtle bg-fb-surface-page/95 p-3 md:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Jordutkast</p>
            <p className="truncate text-sm font-semibold text-fb-text-primary">
              {propertyLabel ?? "Ingen aktiv eiendom"}
            </p>
          </div>
          {createMode ? (
            <Button type="button" size="sm" variant="outline" onClick={onCancelCreate}>
              Avbryt
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onStartCreate} disabled={!canEdit}>
              <Plus className="h-3.5 w-3.5" />
              Nytt jordutkast
            </Button>
          )}
        </div>

        <p className="mt-2 text-xs leading-5 text-fb-text-secondary">{fieldStatus}</p>
        {!canEdit ? (
          <p className="mt-1 text-[11px] leading-5 text-fb-text-secondary">
            Admin-tilgang kreves for å opprette, flytte og lagre jorder.
          </p>
        ) : null}

        {createMode && !hasActiveDraft ? (
          <div className="mt-3 rounded-2xl border border-dashed border-fb-border-strong bg-fb-surface-ghost px-3 py-3 text-sm text-fb-text-primary">
            <div className="flex items-center gap-2">
              <Crosshair className="h-4 w-4 text-[color:var(--fb-season-solid)]" />
              <span className="font-medium">Klikk i kartet for å finne jordet og starte et utkast</span>
            </div>
            <p className="mt-1 pl-6 text-xs leading-5 text-fb-text-secondary">
              Vi prøver først å hente riktig teig automatisk. Hvis vi ikke finner den, lager vi et manuelt startpolygon som du kan dra videre.
            </p>
          </div>
        ) : null}

        <div className="mt-3 space-y-2">
          {fieldPlots.length === 0 ? (
            <div className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-3 text-sm text-fb-text-secondary">
              Ingen lagrede jorder ennå.
            </div>
          ) : (
            fieldPlots.map((field) => {
              const active = activeFieldId === field.id;
              return (
                <button
                  key={field.id}
                  type="button"
                  onClick={() => onSelectField(field.id)}
                  className={cn(
                    "flex w-full items-start justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-fb-border-strong bg-fb-surface-page text-fb-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.34)]"
                      : "border-fb-border-subtle bg-fb-surface-ghost text-fb-text-primary hover:bg-fb-surface-page",
                  )}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{field.name ?? `Jord ${field.id}`}</p>
                    <p className="mt-0.5 text-xs text-fb-text-secondary">
                      {field.status === "confirmed" ? "Bekreftet" : "Utkast"} · {formatFieldArea(field.area_ha)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "mt-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em]",
                      active
                        ? "bg-fb-surface-overlay text-fb-text-primary"
                        : "bg-fb-surface-page text-fb-text-secondary",
                    )}
                  >
                    {active ? "Valgt" : "Åpne"}
                  </span>
                </button>
              );
            })
          )}
        </div>

        {activeFieldDraft ? (
          <div className="mt-3 rounded-[22px] border border-fb-border-strong bg-[color:color-mix(in_srgb,var(--fb-season-solid)_7%,white)] p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">
                  {activeFieldDraft.isNew ? "Nytt jordutkast" : "Aktiv jord"}
                </p>
                <p className="text-sm font-semibold text-fb-text-primary">
                  {activeFieldDraft.isDirty ? "Ulagerte endringer" : "Klar"}
                </p>
              </div>
              <div className="inline-flex items-center gap-1 rounded-full bg-fb-surface-page px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-fb-text-secondary">
                <PencilLine className="h-3.5 w-3.5" />
                Dra hjørner
              </div>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Navn</span>
              <input
                type="text"
                value={activeFieldDraft.name ?? ""}
                onChange={(event) => onChangeDraftName(event.target.value)}
                placeholder="Jordnavn"
                disabled={!canEdit}
                className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
              />
            </label>

            <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Areal</p>
                <p className="text-sm font-semibold text-fb-text-primary">{formatFieldArea(activeFieldDraft.area_ha)}</p>
              </div>
              <div className="text-right text-xs text-fb-text-secondary">
                {activeFieldDraft.isNew ? "Lagres som utkast" : "Oppdaterer valgt jord"}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button type="button" size="sm" onClick={onSaveDraft} loading={saveBusy} loadingLabel="Lagrer jord" disabled={!canEdit}>
                <Save className="h-3.5 w-3.5" />
                Lagre
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={onDiscardDraft}>
                Forkast endringer
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onDeleteDraft} loading={deleteBusy} loadingLabel="Sletter jord" disabled={!canEdit}>
                <Trash2 className="h-3.5 w-3.5" />
                {activeFieldDraft.isNew ? "Fjern utkast" : "Slett"}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-3 rounded-[22px] border border-fb-border-strong bg-[color:color-mix(in_srgb,var(--fb-season-solid)_6%,white)] p-3">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Flyoppdrag</p>
              <p className="text-sm font-semibold text-fb-text-primary">Planlegg rute fra lagrede jorder</p>
            </div>
            <div className="inline-flex items-center gap-1 rounded-full bg-fb-surface-page px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-fb-text-secondary">
              <Plane className="h-3.5 w-3.5" />
              HEN-14
            </div>
          </div>

          <p className="text-xs leading-5 text-fb-text-secondary">{missionStatus}</p>
          {!canEdit ? (
            <p className="mt-1 text-[11px] leading-5 text-fb-text-secondary">
              Admin-tilgang kreves for å opprette og eksportere flyoppdrag.
            </p>
          ) : null}

          {fieldPlots.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-fb-border-strong bg-fb-surface-page px-3 py-3 text-sm text-fb-text-secondary">
              Lagre minst ett jordutkast først. Oppdrag bygges fra gårdens lagrede jorder.
            </div>
          ) : (
            <>
              <label className="mt-3 block">
                <span className="mb-1.5 block text-xs font-medium text-fb-text-secondary">Oppdragsnavn</span>
                <input
                  type="text"
                  value={missionName}
                  onChange={(event) => onChangeMissionName(event.target.value)}
                  placeholder="Oppdrag vår 2026"
                  disabled={!canEdit}
                  className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                />
              </label>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Høyde (m)</span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="1"
                    value={missionParameters.altitude_m}
                    onChange={(event) => onChangeMissionParameter("altitude_m", event.target.value)}
                    disabled={!canEdit}
                    className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Rutevinkel</span>
                  <input
                    type="number"
                    min="0"
                    max="180"
                    step="1"
                    value={missionParameters.route_angle_deg}
                    onChange={(event) => onChangeMissionParameter("route_angle_deg", event.target.value)}
                    disabled={!canEdit}
                    className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Linjeavstand</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    value={missionParameters.line_spacing_m}
                    onChange={(event) => onChangeMissionParameter("line_spacing_m", event.target.value)}
                    disabled={!canEdit}
                    className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] uppercase tracking-[0.08em] text-fb-text-secondary">Waypoint-avstand</span>
                  <input
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    value={missionParameters.waypoint_spacing_m}
                    onChange={(event) => onChangeMissionParameter("waypoint_spacing_m", event.target.value)}
                    disabled={!canEdit}
                    className="w-full rounded-2xl border border-fb-border-subtle bg-fb-surface-page px-3 py-2 text-sm text-fb-text-primary outline-none transition-colors focus:border-fb-border-strong"
                  />
                </label>
              </div>

              <div className="mt-3">
                <p className="mb-1.5 text-xs font-medium text-fb-text-secondary">Jorder i oppdraget</p>
                <div className="flex flex-wrap gap-2">
                  {fieldPlots.map((field) => {
                    const selected = selectedMissionFieldIds.includes(field.id);
                    return (
                      <button
                        key={`mission-field-${field.id}`}
                        type="button"
                        onClick={() => onToggleMissionField(field.id)}
                        disabled={!canEdit}
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                          selected
                            ? "border-fb-border-strong bg-fb-surface-page text-fb-text-primary"
                            : "border-fb-border-subtle bg-fb-surface-ghost text-fb-text-secondary hover:bg-fb-surface-page",
                        )}
                      >
                        {field.name ?? `Jord ${field.id}`}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={onCreateMission}
                  loading={missionCreateBusy}
                  loadingLabel="Lager oppdrag"
                  disabled={!canEdit || selectedMissionFieldIds.length === 0}
                >
                  <Plane className="h-3.5 w-3.5" />
                  Lag oppdrag
                </Button>
              </div>
            </>
          )}

          {missions.length > 0 ? (
            <div className="mt-3 space-y-2">
              {missions.slice(0, 4).map((mission) => (
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
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={activeMissionId === mission.id ? "default" : "outline"}
                        onClick={() => onSelectMission(mission.id)}
                      >
                        {activeMissionId === mission.id ? "Vises i kart" : "Vis i kart"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onExportMission(mission.id)}
                        loading={missionExportBusyId === mission.id}
                        loadingLabel="Eksporterer"
                        disabled={!canEdit}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Eksporter
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
