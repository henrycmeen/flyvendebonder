import { CloseButton } from "@/components/ui/close-button";
import { ORTHOPHOTO_QUALITY_FLAG_LABELS } from "@/lib/orthophoto-color-analysis";
import type { OrthophotoColorAnalysisOutcome } from "@/lib/browser-orthophoto-sampler";

interface OrthophotoColorAnalysisPopupProps {
  outcome: OrthophotoColorAnalysisOutcome;
  onClose: () => void;
}

function formatRgb({ r, g, b }: { r: number; g: number; b: number }): string {
  return `${r.toFixed(1)}, ${g.toFixed(1)}, ${b.toFixed(1)}`;
}

function formatIndex(value: number): string {
  return value.toFixed(3);
}

function formatGsd(gsd: { x: number; y: number } | null | undefined): string | null {
  if (!gsd || !Number.isFinite(gsd.x) || !Number.isFinite(gsd.y)) return null;
  return `${gsd.x.toFixed(2)} x ${gsd.y.toFixed(2)} m/px`;
}

function formatDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

export function OrthophotoColorAnalysisPopup({ outcome, onClose }: OrthophotoColorAnalysisPopupProps) {
  const isAnalysis = outcome.status === "analysis";

  return (
    <aside className="fb-map-overlay-panel pointer-events-auto w-[min(26rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-fb-border-subtle bg-[color:color-mix(in_srgb,var(--fb-surface-page)_96%,white)] shadow-fb-floating backdrop-blur">
      <div className="flex items-start justify-between gap-3 border-b border-fb-border-subtle px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-fb-text-secondary">Fargeanalyse</p>
          <h2 className="truncate text-base font-semibold text-fb-text-primary">
            {isAnalysis ? outcome.overlay.label : "Ingen prøve"}
          </h2>
        </div>
        <CloseButton label="Lukk fargeanalyse" onClick={onClose} className="h-8 w-8 shrink-0" />
      </div>

      {isAnalysis ? (
        <div className="max-h-[min(68vh,34rem)] overflow-y-auto px-4 py-3 text-sm text-fb-text-primary">
          <div className="grid grid-cols-2 gap-2 text-xs text-fb-text-secondary">
            <span>Kilde</span>
            <span className="text-right text-fb-text-primary">{outcome.overlay.label}</span>
            <span>Prøvekilde</span>
            <span className="text-right text-fb-text-primary" title={outcome.source.detail}>
              {outcome.source.label}
            </span>
            <span>Dato</span>
            <span className="text-right text-fb-text-primary">{formatDate(outcome.overlay.capturedDate)}</span>
            <span>Prøveflate</span>
            <span className="text-right text-fb-text-primary">
              {outcome.analysis.requestedSizePx} x {outcome.analysis.requestedSizePx} px
            </span>
            <span>Gyldige piksler</span>
            <span className="text-right text-fb-text-primary">
              {outcome.analysis.validPixels} av {outcome.analysis.sampledPixels}
            </span>
            <span>Kantklipping</span>
            <span className="text-right text-fb-text-primary">{outcome.analysis.clipped ? "Ja" : "Nei"}</span>
            {formatGsd(outcome.source.gsdMPerPx) ? (
              <>
                <span>Oppløsning</span>
                <span className="text-right text-fb-text-primary">{formatGsd(outcome.source.gsdMPerPx)}</span>
              </>
            ) : null}
          </div>

          <div className="mt-3 rounded-xl bg-fb-surface-ghost p-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <span className="text-fb-text-secondary">Mean RGB</span>
              <span className="text-right font-medium">{formatRgb(outcome.analysis.meanRgb)}</span>
              <span className="text-fb-text-secondary">Median RGB</span>
              <span className="text-right font-medium">{formatRgb(outcome.analysis.medianRgb)}</span>
              <span className="text-fb-text-secondary">Relativ lysstyrke</span>
              <span className="text-right font-medium">{outcome.analysis.brightness.toFixed(3)}</span>
              <span className="text-fb-text-secondary">Lysvurdering</span>
              <span className="text-right font-medium">{outcome.analysis.lightAssessment}</span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
            {Object.entries(outcome.analysis.indices).map(([key, value]) => (
              <div key={key} className="rounded-lg bg-fb-surface-ghost px-2 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-fb-text-secondary">{key}</p>
                <p className="mt-1 text-xs font-semibold text-fb-text-primary">{formatIndex(value)}</p>
              </div>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {outcome.analysis.qualityFlags.length > 0 ? (
              outcome.analysis.qualityFlags.map((flag) => (
                <span key={flag} className="rounded-full bg-fb-surface-ghost px-2 py-1 text-xs text-fb-text-secondary">
                  {ORTHOPHOTO_QUALITY_FLAG_LABELS[flag]}
                </span>
              ))
            ) : (
              <span className="rounded-full bg-fb-surface-ghost px-2 py-1 text-xs text-fb-text-secondary">
                Ingen tydelige kvalitetsflagg
              </span>
            )}
          </div>

          <p className="mt-3 text-xs leading-5 text-fb-text-secondary">
            Relative RGB-indikatorer fra {outcome.source.label.toLocaleLowerCase("nb-NO")}. Dette er ikke gjødslingsråd, sykdomsdiagnose eller
            erstatning for feltobservasjon.
          </p>
        </div>
      ) : (
        <div className="px-4 py-4 text-sm leading-5 text-fb-text-secondary">
          <p>{outcome.reason}</p>
          <p className="mt-2">
            Fargeanalyse bruker bare synlige ortofoto for valgt eiendom, år og sesong.
          </p>
        </div>
      )}
    </aside>
  );
}
