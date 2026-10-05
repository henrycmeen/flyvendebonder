import { useMemo } from "react";
import { ArrowUpRight, CalendarDays } from "lucide-react";

import { PageShell } from "@/components/ui/layout-primitives";
import { splitCapturedDate } from "@/lib/formatters";
import type { OrthophotoOverlayDefinition } from "@/lib/orthophoto-overlays";

interface OrthophotoPageProps {
  overlays: OrthophotoOverlayDefinition[];
  onOpenInMap: (overlayId: string) => void;
}

interface OverlayGroup {
  key: string;
  label: string;
  overlays: OrthophotoOverlayDefinition[];
}

function toPropertyShortLabel(propertyReference: string): string {
  const [, remainder] = propertyReference.split("-", 2);
  if (!remainder) return propertyReference;
  const [parcel] = remainder.split("/", 2);
  return parcel;
}

function extractFieldNumber(label: string): number {
  const match = label.match(/jorde\s+(\d+)/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function formatCapturedDate(value: string): string {
  if (!splitCapturedDate(value)) return value;
  const date = new Date(`${value}T12:00:00`);
  return date.toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

export function OrthophotoPage({ overlays, onOpenInMap }: OrthophotoPageProps) {
  const groups = useMemo<OverlayGroup[]>(() => {
    const grouped = new Map<string, OrthophotoOverlayDefinition[]>();

    overlays.forEach((overlay) => {
      const key = overlay.propertyReference;
      const existing = grouped.get(key);
      if (existing) {
        existing.push(overlay);
      } else {
        grouped.set(key, [overlay]);
      }
    });

    return Array.from(grouped.entries())
      .map(([key, items]) => ({
        key,
        label: toPropertyShortLabel(key),
        overlays: [...items].sort((left, right) => {
          const fieldDiff = extractFieldNumber(left.label) - extractFieldNumber(right.label);
          if (fieldDiff !== 0) return fieldDiff;
          return left.label.localeCompare(right.label, "nb-NO");
        }),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "nb-NO", { numeric: true }));
  }, [overlays]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-[620] overflow-y-auto">
      <div className="min-h-full bg-fb-surface-base px-3 pb-8 pt-4 sm:px-6 sm:pt-6">
        <PageShell maxWidth="wide" className="px-0">
          <div className="space-y-6 pb-4">
            <h1 className="text-xl font-semibold tracking-tight text-fb-text-primary">Ortofoto</h1>

            {groups.map((group) => (
              <section key={group.key} className="space-y-4">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-lg font-semibold tracking-tight text-fb-text-primary">{group.label}</h2>
                  <p className="text-sm text-fb-text-secondary">{group.overlays.length} ortofoto</p>
                </div>

                <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {group.overlays.map((overlay) => (
                    <button
                      key={overlay.id}
                      type="button"
                      onClick={() => onOpenInMap(overlay.id)}
                      className="group text-left"
                    >
                      <div className="space-y-3">
                        <img
                          src={overlay.imageUrl}
                          alt={overlay.label}
                          className="block w-full rounded-xl object-cover"
                          loading="lazy"
                        />
                        <div className="flex items-start justify-between gap-3 px-1">
                          <div className="space-y-1">
                            <p className="text-base font-semibold tracking-tight text-fb-text-primary">{overlay.label}</p>
                            <div className="flex items-center gap-2 text-sm text-fb-text-secondary">
                              <CalendarDays className="h-4 w-4" />
                              <span>{formatCapturedDate(overlay.capturedDate)}</span>
                            </div>
                          </div>
                          <span className="inline-flex h-9 w-9 items-center justify-center text-fb-text-secondary">
                            <ArrowUpRight className="h-4 w-4" />
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </PageShell>
      </div>
    </div>
  );
}
