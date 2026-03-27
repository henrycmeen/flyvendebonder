import { Crosshair, PencilLine, Plus, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FieldPlot, FieldPlotDraft } from "@/types";

interface FieldEditorPanelProps {
  propertyLabel: string | null;
  fieldStatus: string;
  canEdit: boolean;
  createMode: boolean;
  fieldPlots: FieldPlot[];
  activeFieldDraft: FieldPlotDraft | null;
  saveBusy: boolean;
  deleteBusy: boolean;
  onStartCreate: () => void;
  onCancelCreate: () => void;
  onSelectField: (fieldId: number) => void;
  onChangeDraftName: (value: string) => void;
  onSaveDraft: () => void;
  onDiscardDraft: () => void;
  onDeleteDraft: () => void;
  onOpenPlanning: () => void;
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

export function FieldEditorPanel({
  propertyLabel,
  fieldStatus,
  canEdit,
  createMode,
  fieldPlots,
  activeFieldDraft,
  saveBusy,
  deleteBusy,
  onStartCreate,
  onCancelCreate,
  onSelectField,
  onChangeDraftName,
  onSaveDraft,
  onDiscardDraft,
  onDeleteDraft,
  onOpenPlanning,
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
          <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Planlegging</p>
          <p className="mt-1 text-sm font-semibold text-fb-text-primary">Flyplan, flytid og eksport er flyttet ut av kartet.</p>
          <p className="mt-2 text-xs leading-5 text-fb-text-secondary">
            Bruk arbeidsflaten <span className="font-medium text-fb-text-primary">Planlegging</span> for å dele jorder, beregne flytid, lagre oppdrag og eksportere.
          </p>
          <div className="mt-3">
            <Button type="button" size="sm" onClick={onOpenPlanning}>
              Åpne Planlegging
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
