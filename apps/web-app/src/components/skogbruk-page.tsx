import { useMemo } from "react";
import { ArrowUpRight } from "lucide-react";

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

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-4 sm:px-6 sm:pt-6">
        <PageShell maxWidth="wide" className="px-0">
          <div className="space-y-5 pb-4">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-fb-text-primary">Skogbruk</h1>
              <div className="flex items-center gap-3">
                <label htmlFor="skogbruk-naturskog" className="text-sm text-fb-text-secondary">Naturskogindikasjon i kartet</label>
                <Switch
                  id="skogbruk-naturskog"
                  checked={showForestLayer}
                  onCheckedChange={onToggleForestLayer}
                  aria-label="Vis naturskogindikasjon i kartet"
                />
              </div>
            </header>

            <section aria-label="Skogortofoto" className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {forestOverlays.map((overlay) => (
                <article key={overlay.id} className="space-y-2">
                  <img src={overlay.imageUrl} alt={overlay.label} className="aspect-[16/10] w-full rounded-xl object-cover" loading="lazy" />
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-base font-semibold text-fb-text-primary">{overlay.label}</h2>
                      <p className="text-sm text-fb-text-secondary">{formatCapturedDate(overlay.capturedDate)}</p>
                      <p className="text-xs text-fb-text-secondary">{overlay.propertyReference}</p>
                      <p className="text-xs text-fb-text-secondary">Ca. {formatAreaHa(estimateOverlayAreaHa(overlay))} fra bildeavgrensning</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => onOpenInMap(overlay.id)} aria-label={`Åpne ${overlay.label} i kart`}>
                      <ArrowUpRight className="h-4 w-4" />
                      Kart
                    </Button>
                  </div>
                </article>
              ))}
            </section>

            <details className="border-t border-fb-border-subtle pt-3 text-sm text-fb-text-secondary">
              <summary className="cursor-pointer font-medium text-fb-text-primary">Om datagrunnlaget</summary>
              <div className="mt-3 max-w-2xl space-y-3 leading-6">
                <p>{forestOverlays.length} ortofoto · ca. {formatAreaHa(totalAreaHa)} fra bildeavgrensning. Arealet er et anslag fra bildenes kartutsnitt.</p>
                <p>Naturskogindikasjonen er et arbeidslag for prioritering. Den må tolkes sammen med feltbefaring, offentlig kartgrunnlag og lokale driftsavklaringer før den brukes som beslutningsgrunnlag.</p>
                <p className="font-medium text-fb-text-primary">Videre arbeid</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Registrer hvilke skogflater som trenger ny flyging.</li>
                  <li>Koble skogflate til samme eiendoms- og planleggingsgrunnlag som jordene.</li>
                  <li>Dokumenter om funn er observasjon, indikasjon eller verifisert faggrunnlag.</li>
                </ul>
              </div>
            </details>
          </div>
        </PageShell>
      </div>
    </div>
  );
}
