import { useMemo } from "react";
import { ArrowUpRight, Layers, Map, ShieldAlert, Trees } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/ui/layout-primitives";
import { Switch } from "@/components/ui/switch";
import type { OrthophotoOverlayDefinition } from "@/lib/orthophoto-overlays";

interface SkogbrukPageProps {
  overlays: OrthophotoOverlayDefinition[];
  showForestLayer: boolean;
  onToggleForestLayer: (next: boolean) => void;
  onOpenInMap: (overlayId: string) => void;
}

interface Metric {
  label: string;
  value: string;
  detail: string;
}

function isForestOverlay(overlay: OrthophotoOverlayDefinition): boolean {
  const text = `${overlay.id} ${overlay.label}`.toLocaleLowerCase("nb-NO");
  return text.includes("skog");
}

function estimateOverlayAreaHa(overlay: OrthophotoOverlayDefinition): number {
  const { bounds } = overlay;
  const midLatRad = ((bounds.south + bounds.north) / 2) * (Math.PI / 180);
  const widthM = Math.abs(bounds.east - bounds.west) * 111_320 * Math.cos(midLatRad);
  const heightM = Math.abs(bounds.north - bounds.south) * 110_540;
  return (widthM * heightM) / 10_000;
}

function formatAreaHa(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 daa";
  if (value < 1) return `${Math.round(value * 10)} daa`;
  return `${value.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} ha`;
}

function formatCapturedDate(value: string): string {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function SkogbrukPage({
  overlays,
  showForestLayer,
  onToggleForestLayer,
  onOpenInMap,
}: SkogbrukPageProps) {
  const forestOverlays = useMemo(
    () =>
      overlays
        .filter(isForestOverlay)
        .sort((left, right) => left.label.localeCompare(right.label, "nb-NO", { numeric: true })),
    [overlays],
  );

  const totalAreaHa = useMemo(
    () => forestOverlays.reduce((total, overlay) => total + estimateOverlayAreaHa(overlay), 0),
    [forestOverlays],
  );

  const metrics = useMemo<Metric[]>(
    () => [
      {
        label: "Skogflater",
        value: forestOverlays.length.toLocaleString("nb-NO"),
        detail: "ortofoto registrert",
      },
      {
        label: "Kartlagt flate",
        value: formatAreaHa(totalAreaHa),
        detail: "fra bildeavgrensning",
      },
      {
        label: "Datagrunnlag",
        value: showForestLayer ? "På" : "Av",
        detail: "indikativt kartlag",
      },
    ],
    [forestOverlays.length, showForestLayer, totalAreaHa],
  );

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-20 sm:px-6 sm:pt-6">
        <PageShell maxWidth="wide" className="px-0">
          <div className="space-y-8 pb-8">
            <header className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
              <div className="space-y-2">
                <p className="text-[13px] font-semibold uppercase tracking-[0.24em] text-fb-text-muted">Skogbruk</p>
                <h1 className="text-3xl font-semibold tracking-[-0.03em] text-fb-text-primary">
                  Skogdashboard og naturskogindikasjon
                </h1>
                <p className="max-w-3xl text-sm leading-6 text-fb-text-secondary">
                  Første skogflate bruker eksisterende eiendoms- og kartgrunnmur, egne skog-ortofoto og et markert
                  indikativt lag for områder som må vurderes med fagdata før beslutning.
                </p>
              </div>

              <div className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-fb-text-primary">Naturskogindikasjon</p>
                    <p className="text-xs leading-5 text-fb-text-secondary">Vis avgrensningene i kartet</p>
                  </div>
                  <Switch
                    id="skogbruk-naturskog"
                    checked={showForestLayer}
                    onCheckedChange={onToggleForestLayer}
                    aria-label="Vis naturskogindikasjon i kartet"
                  />
                </div>
              </div>
            </header>

            <section className="grid gap-3 sm:grid-cols-3" aria-label="Skogbruk nøkkeltall">
              {metrics.map((metric) => (
                <div key={metric.label} className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-fb-text-muted">{metric.label}</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-fb-text-primary">{metric.value}</p>
                  <p className="mt-1 text-sm text-fb-text-secondary">{metric.detail}</p>
                </div>
              ))}
            </section>

            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <section className="space-y-4" aria-labelledby="skogbruk-overlays-title">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="space-y-1">
                    <h2 id="skogbruk-overlays-title" className="text-2xl font-semibold tracking-[-0.03em] text-fb-text-primary">
                      Skogflater
                    </h2>
                    <p className="text-sm text-fb-text-secondary">{forestOverlays.length} tilgjengelige ortofoto</p>
                  </div>
                </div>

                <div className="grid gap-5 md:grid-cols-2">
                  {forestOverlays.map((overlay) => (
                    <article key={overlay.id} className="overflow-hidden rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost">
                      <img src={overlay.imageUrl} alt={overlay.label} className="aspect-[16/10] w-full object-cover" loading="lazy" />
                      <div className="space-y-3 px-4 py-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="truncate text-lg font-semibold tracking-[-0.02em] text-fb-text-primary">{overlay.label}</h3>
                            <p className="text-sm text-fb-text-secondary">{formatCapturedDate(overlay.capturedDate)}</p>
                          </div>
                          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fb-surface-page text-[color:var(--fb-map-forest)]">
                            <Trees className="h-4 w-4" />
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-fb-text-secondary">
                          <span className="inline-flex items-center gap-1 rounded-full border border-fb-border-subtle bg-fb-surface-page px-2 py-1">
                            <Map className="h-3.5 w-3.5" />
                            {formatAreaHa(estimateOverlayAreaHa(overlay))}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-fb-border-subtle bg-fb-surface-page px-2 py-1">
                            <Layers className="h-3.5 w-3.5" />
                            {overlay.propertyReference}
                          </span>
                        </div>
                        <Button type="button" variant="outline" size="sm" onClick={() => onOpenInMap(overlay.id)}>
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          Åpne i kart
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <aside className="space-y-3">
                <section className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-4">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fb-surface-page text-[color:var(--fb-map-forest)]">
                      <ShieldAlert className="h-4 w-4" />
                    </span>
                    <div className="space-y-2">
                      <h2 className="text-sm font-semibold text-fb-text-primary">Kunnskapsgrunnlag</h2>
                      <p className="text-sm leading-6 text-fb-text-secondary">
                        Naturskogindikasjonen er et arbeidslag for prioritering. Den må tolkes sammen med feltbefaring,
                        offentlig kartgrunnlag og lokale driftsavklaringer før den brukes som beslutningsgrunnlag.
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-fb-border-subtle bg-fb-surface-ghost px-4 py-4">
                  <h2 className="text-sm font-semibold text-fb-text-primary">Neste operasjonelle steg</h2>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-fb-text-secondary">
                    <li>Registrer hvilke skogflater som trenger ny flyging.</li>
                    <li>Koble skogflate til samme eiendoms- og planleggingsgrunnlag som jordene.</li>
                    <li>Dokumenter om funn er observasjon, indikasjon eller verifisert faggrunnlag.</li>
                  </ul>
                </section>
              </aside>
            </div>
          </div>
        </PageShell>
      </div>
    </div>
  );
}
