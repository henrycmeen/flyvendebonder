import { CheckCircle2, ChevronRight, MapPinned, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { operatingRelationLabel, type OperatingAreaToolState } from "@/lib/operating-area-tool";
import { cn } from "@/lib/utils";
import type { OperatingAreaCandidate, OperatingAreaConfirmResponse, OperatingRelation } from "@/types";

interface OperatingAreaInspectorProps {
  state: OperatingAreaToolState;
  selectedCandidate: OperatingAreaCandidate | null;
  confirmation: OperatingAreaConfirmResponse | null;
  canConfirm: boolean;
  onSelectCandidate: (candidateId: string) => void;
  onConfirm: (relation: OperatingRelation) => void;
  onInspectMapCenter: () => void;
  onCancel: () => void;
  onOpenPlanning: () => void;
}

function candidateTitle(candidate: OperatingAreaCandidate): string {
  return candidate.name?.trim() || candidate.property_ref.label?.trim() || candidate.matrikkelnummer || "Navnløs teig";
}

function sourceDate(candidate: OperatingAreaCandidate): string | null {
  const raw = candidate.source_updated_at ?? candidate.source_fetched_at;
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("nb-NO", { dateStyle: "medium" }).format(date);
}

function sourceHost(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).hostname;
  } catch {
    return null;
  }
}

function CandidateDetails({ candidate }: { candidate: OperatingAreaCandidate }) {
  const updated = sourceDate(candidate);
  const host = sourceHost(candidate.source_endpoint);
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
      <dt className="text-fb-text-secondary">Matrikkel</dt>
      <dd className="min-w-0 text-right font-medium text-fb-text-primary">{candidate.matrikkelnummer ?? "Ikke oppgitt"}</dd>
      <dt className="text-fb-text-secondary">Kommune</dt>
      <dd className="text-right font-medium text-fb-text-primary">{candidate.property_ref.komm}</dd>
      <dt className="text-fb-text-secondary">Areal</dt>
      <dd className="text-right font-medium text-fb-text-primary">
        {candidate.area_ha == null ? "Ikke beregnet" : `${candidate.area_ha.toLocaleString("nb-NO", { maximumFractionDigits: 2 })} ha`}
      </dd>
      <dt className="text-fb-text-secondary">Kilde</dt>
      <dd className="min-w-0 truncate text-right font-medium text-fb-text-primary" title={candidate.source_endpoint ?? candidate.source}>
        {candidate.source}{host ? ` · ${host}` : ""}
      </dd>
      {candidate.accuracy_class ? (
        <>
          <dt className="text-fb-text-secondary">Nøyaktighet</dt>
          <dd className="text-right font-medium text-fb-text-primary">{candidate.accuracy_class}</dd>
        </>
      ) : null}
      {updated ? (
        <>
          <dt className="text-fb-text-secondary">Kildedato</dt>
          <dd className="text-right font-medium text-fb-text-primary">{updated}</dd>
        </>
      ) : null}
    </dl>
  );
}

export function OperatingAreaInspector({
  state,
  selectedCandidate,
  confirmation,
  canConfirm,
  onSelectCandidate,
  onConfirm,
  onInspectMapCenter,
  onCancel,
  onOpenPlanning,
}: OperatingAreaInspectorProps) {
  if (!state.active) return null;

  const isConfirming = state.phase === "confirming";
  const ownerMessage = state.preview?.owner_information_message;
  return (
    <section
      className="pointer-events-auto max-h-[min(70vh,36rem)] w-[calc(100vw-1.5rem)] overflow-y-auto rounded-2xl border border-fb-border-subtle bg-fb-surface-page p-4 shadow-fb-floating sm:w-[25rem]"
      aria-labelledby="operating-area-title"
      aria-live="polite"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 rounded-lg bg-fb-surface-ghost p-2 text-fb-text-primary" aria-hidden="true">
            <MapPinned className="h-4 w-4" />
          </span>
          <div>
            <h2 id="operating-area-title" className="text-sm font-semibold text-fb-text-primary">Legg til jorde</h2>
            <p className="mt-0.5 text-xs leading-5 text-fb-text-secondary">
              {state.phase === "ready" ? "Trykk på et jorde i kartet. Esc avslutter." : "Kontroller teigdata før du legger jordet til gården."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={isConfirming}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fb-text-secondary hover:bg-fb-surface-ghost hover:text-fb-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid"
          aria-label="Avslutt jordeverktøy"
          title="Avslutt (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      {state.phase === "loading" ? (
        <div className="mt-4 rounded-xl bg-fb-surface-ghost p-3 text-sm text-fb-text-secondary" role="status">
          Henter teigdata …
        </div>
      ) : null}

      {state.phase === "ready" ? (
        <Button type="button" variant="outline" className="mt-4 w-full" onClick={onInspectMapCenter}>
          Undersøk kartets sentrum
        </Button>
      ) : null}

      {state.phase === "empty" || state.phase === "error" ? (
        <div className="mt-4 rounded-xl border border-fb-border-subtle bg-fb-surface-ghost p-3 text-sm text-fb-text-primary" role="alert">
          {state.error ?? "Fant ingen teig på dette punktet. Prøv litt lenger inn på jordet."}
        </div>
      ) : null}

      {state.phase === "success" && confirmation ? (
        <div className="mt-4 space-y-3">
          <div className="flex gap-2 rounded-xl border border-[color:color-mix(in_srgb,var(--fb-accent-emerald)_42%,transparent)] bg-[color:color-mix(in_srgb,var(--fb-accent-emerald)_10%,var(--fb-surface-page))] p-3">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--fb-accent-emerald)]" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-fb-text-primary">Jordet er lagt til</p>
              <p className="mt-1 text-xs leading-5 text-fb-text-secondary">
                {confirmation.property.label ?? selectedCandidate?.matrikkelnummer ?? "Teigen"} er klar i planlegging.
              </p>
            </div>
          </div>
          <Button type="button" className="w-full" onClick={onOpenPlanning}>
            Åpne planlegging <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}

      {(state.preview?.candidates.length ?? 0) > 1 && state.phase !== "success" ? (
        <fieldset className="mt-4">
          <legend className="mb-2 text-xs font-medium text-fb-text-secondary">Velg én av teigene som ble funnet</legend>
          <div className="grid gap-1.5">
            {state.preview?.candidates.map((candidate) => {
              const selected = candidate.candidate_id === selectedCandidate?.candidate_id;
              return (
                <button
                  key={candidate.candidate_id}
                  type="button"
                  onClick={() => onSelectCandidate(candidate.candidate_id)}
                  disabled={isConfirming}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid",
                    selected ? "border-fb-season-solid bg-fb-surface-ghost" : "border-fb-border-subtle bg-fb-surface-page",
                  )}
                  aria-pressed={selected}
                >
                  <span className="min-w-0 truncate text-sm font-medium text-fb-text-primary">{candidateTitle(candidate)}</span>
                  <span className="shrink-0 text-xs text-fb-text-secondary">{candidate.distance_m == null ? "" : `${candidate.distance_m} m`}</span>
                </button>
              );
            })}
          </div>
        </fieldset>
      ) : null}

      {selectedCandidate && state.phase !== "success" ? (
        <div className="mt-4 space-y-3">

          <div className="rounded-xl bg-fb-surface-ghost p-3">
            <h3 className="mb-2 text-sm font-semibold text-fb-text-primary">{candidateTitle(selectedCandidate)}</h3>
            <CandidateDetails candidate={selectedCandidate} />
          </div>

          {selectedCandidate.existing ? (
            <p className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2 text-xs leading-5 text-fb-text-primary">
              Allerede tilknyttet som {operatingRelationLabel(selectedCandidate.existing.operating_relation).toLowerCase()}.
            </p>
          ) : null}

          {ownerMessage ? (
            <p className="text-xs leading-5 text-fb-text-secondary">{ownerMessage}</p>
          ) : null}

          {!canConfirm ? (
            <p className="rounded-xl border border-fb-border-subtle bg-fb-surface-ghost px-3 py-2 text-xs leading-5 text-fb-text-primary">
              Admininnlogging kreves for å legge til eller endre tilknytningen. Oppslaget over er skrivebeskyttet.
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Velg tilknytning til jordet">
            <Button type="button" size="sm" disabled={!canConfirm || isConfirming} loading={isConfirming} onClick={() => onConfirm("leased")}>
              Jeg leier
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={!canConfirm || isConfirming} loading={isConfirming} onClick={() => onConfirm("owned")}>
              Jeg eier
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={!canConfirm || isConfirming} loading={isConfirming} onClick={() => onConfirm("unknown")}>
              Ikke angi
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
