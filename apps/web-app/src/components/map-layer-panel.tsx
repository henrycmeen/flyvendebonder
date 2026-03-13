import { cn } from "@/lib/utils";

interface LayerRowProps {
  active: boolean;
  label: string;
  status: string;
  accentClassName: string;
  onToggle: (next: boolean) => void;
}

function LayerRow({ active, label, status, accentClassName, onToggle }: LayerRowProps) {
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => onToggle(!active)}
        className={cn(
          "group flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors",
          active
            ? "border-fb-border-strong bg-fb-surface-page text-fb-text-primary hover:bg-fb-surface-ghost"
            : "border-fb-border-subtle bg-fb-surface-ghost text-fb-text-secondary hover:bg-fb-surface-page",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "h-2.5 w-2.5 shrink-0 rounded-full border border-white/70 shadow-sm transition-transform group-hover:scale-110",
              active ? accentClassName : "bg-fb-border-subtle",
            )}
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
          </div>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em]",
            active ? "bg-fb-surface-overlay text-fb-text-primary" : "bg-fb-surface-page text-fb-text-secondary",
          )}
        >
          {active ? "På" : "Av"}
        </span>
      </button>
      <p className="px-1 text-xs leading-5 text-fb-text-secondary">{status}</p>
    </div>
  );
}

interface MapLayerPanelProps {
  propertyCount: number;
  showPropertyLayer: boolean;
  propertyStatus: string;
  onTogglePropertyLayer: (next: boolean) => void;
  showSoilLayer: boolean;
  soilStatus: string;
  onToggleSoilLayer: (next: boolean) => void;
  showMissionLayer: boolean;
  missionStatus: string;
  onToggleMissionLayer: (next: boolean) => void;
}

export function MapLayerPanel({
  propertyCount,
  showPropertyLayer,
  propertyStatus,
  onTogglePropertyLayer,
  showSoilLayer,
  soilStatus,
  onToggleSoilLayer,
  showMissionLayer,
  missionStatus,
  onToggleMissionLayer,
}: MapLayerPanelProps) {
  return (
    <div className="pointer-events-none absolute right-3 top-3 z-[870] max-w-[min(22rem,calc(100vw-1.5rem))] px-0 sm:right-4 sm:top-4">
      <div className="fb-map-overlay-preview pointer-events-auto rounded-[22px] border border-fb-border-subtle bg-fb-surface-page/95 p-3 md:p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Kartlag</p>
            <p className="text-sm font-semibold text-fb-text-primary">
              {propertyCount > 0 ? `${propertyCount} eiendommer i spill` : "Ingen eiendommer valgt"}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <LayerRow
            active={showPropertyLayer}
            label="Eiendomsgrenser"
            status={propertyStatus}
            accentClassName="bg-[color:var(--fb-season-solid)]"
            onToggle={onTogglePropertyLayer}
          />
          <LayerRow
            active={showSoilLayer}
            label="Jordsmonn"
            status={soilStatus}
            accentClassName="bg-[color:var(--fb-accent-success)]"
            onToggle={onToggleSoilLayer}
          />
          <LayerRow
            active={showMissionLayer}
            label="Flyrute"
            status={missionStatus}
            accentClassName="bg-[#5b8cf6]"
            onToggle={onToggleMissionLayer}
          />
        </div>
      </div>
    </div>
  );
}
