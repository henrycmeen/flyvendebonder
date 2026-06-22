import { useEffect, useRef, useState } from "react";
import { Filter, Map, Mountain, Satellite } from "lucide-react";

import type { BaseMapStyle } from "@/lib/map-styles";
import { cn } from "@/lib/utils";

interface LayerToggleProps {
  active: boolean;
  label: string;
  status: string;
  accentClassName: string;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
}

function LayerToggle({ active, label, status, accentClassName, onToggle, disabled = false }: LayerToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!active)}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors",
        active
          ? "bg-fb-surface-ghost text-fb-text-primary"
          : "bg-transparent text-fb-text-secondary hover:bg-fb-surface-ghost/80",
        disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
      )}
      title={status}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn(
            "h-2.5 w-2.5 shrink-0 rounded-full transition-transform",
            active ? accentClassName : "bg-fb-border-subtle",
          )}
          aria-hidden="true"
        />
        <span className="truncate text-sm font-medium">{label}</span>
      </span>
      <span
        className={cn(
          "rounded-full px-2 py-0.5 text-[11px] font-medium",
          active ? "bg-fb-surface-page text-fb-text-primary" : "bg-fb-surface-ghost text-fb-text-secondary",
        )}
      >
        {disabled ? "Ikke klar" : active ? "På" : "Av"}
      </span>
    </button>
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
  showForestLayer: boolean;
  forestStatus: string;
  onToggleForestLayer: (next: boolean) => void;
  baseMapStyle: BaseMapStyle;
  onChangeQuickBaseMap: (style: BaseMapStyle) => void;
}

export function MapLayerPanel({
  propertyCount,
  showPropertyLayer,
  propertyStatus,
  onTogglePropertyLayer,
  showSoilLayer,
  soilStatus,
  onToggleSoilLayer,
  showForestLayer,
  forestStatus,
  onToggleForestLayer,
  baseMapStyle,
  onChangeQuickBaseMap,
}: MapLayerPanelProps) {
  const [open, setOpen] = useState(false);
  const [isCyclingBaseMap, setIsCyclingBaseMap] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const quickMapOptions: Array<{ id: BaseMapStyle; label: string; icon: typeof Map }> = [
    { id: "osm", label: "Standard", icon: Map },
    { id: "topo", label: "Topografisk", icon: Mountain },
    { id: "satellite", label: "Satellitt", icon: Satellite },
  ];
  const activeQuickMap = quickMapOptions.find((option) => option.id === baseMapStyle) ?? quickMapOptions[0];
  const ActiveQuickMapIcon = activeQuickMap.icon;
  const hasProperties = propertyCount > 0;

  const handleCycleQuickMap = () => {
    const currentIndex = quickMapOptions.findIndex((option) => option.id === activeQuickMap.id);
    const nextOption = quickMapOptions[(currentIndex + 1) % quickMapOptions.length];
    setIsCyclingBaseMap(true);
    onChangeQuickBaseMap(nextOption.id);
  };

  useEffect(() => {
    if (!isCyclingBaseMap) {
      return undefined;
    }
    const timeout = window.setTimeout(() => setIsCyclingBaseMap(false), 220);
    return () => window.clearTimeout(timeout);
  }, [isCyclingBaseMap, activeQuickMap.id]);

  return (
    <div
      ref={containerRef}
      className="pointer-events-none absolute right-3 top-3 z-[870] flex max-w-[calc(100vw-1.5rem)] items-start gap-1.5 sm:right-4 sm:top-4 sm:gap-2"
    >
      <button
        type="button"
        onClick={handleCycleQuickMap}
        className="fb-map-overlay-trigger pointer-events-auto inline-flex h-10 items-center gap-2 rounded-xl bg-fb-surface-page px-2.5 text-sm font-medium text-fb-text-primary shadow-fb-floating transition-colors hover:bg-fb-surface-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid sm:px-3"
        aria-label={`Bytt kartstil fra ${activeQuickMap.label.toLowerCase()}`}
        title={`Kartstil: ${activeQuickMap.label}. Klikk for å bytte.`}
      >
        <span
          className={cn(
            "inline-flex items-center gap-2 transition-[transform,opacity] duration-200 ease-out",
            isCyclingBaseMap ? "translate-y-[-1px] scale-[0.98] opacity-80" : "translate-y-0 scale-100 opacity-100",
          )}
        >
          <ActiveQuickMapIcon className="h-4 w-4" />
          <span className="hidden sm:inline">{activeQuickMap.label}</span>
        </span>
      </button>

      <div className="pointer-events-auto relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className={cn(
            "fb-map-overlay-trigger inline-flex h-10 w-10 items-center justify-center rounded-xl bg-fb-surface-page text-fb-text-primary shadow-fb-floating transition-colors hover:bg-fb-surface-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fb-season-solid",
            open && "bg-fb-surface-ghost",
          )}
          aria-label="Vis kartfiltre"
          title="Kartfiltre"
          aria-expanded={open}
        >
          <Filter className="h-4 w-4" />
        </button>

        {open ? (
          <div className="absolute right-0 top-12 w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl bg-fb-surface-page p-3 shadow-fb-floating sm:w-72">
            <div className="mb-3 flex items-start justify-between gap-3 px-1">
              <div>
                <p className="text-[11px] uppercase tracking-[0.1em] text-fb-text-secondary">Kartfiltre</p>
                <p className="text-sm font-semibold text-fb-text-primary">
                  {propertyCount > 0 ? `${propertyCount} eiendommer i spill` : "Ingen eiendommer valgt"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <LayerToggle
                active={showPropertyLayer && hasProperties}
                label="Eiendomsgrenser"
                status={hasProperties ? propertyStatus : "Ingen aktive eiendommer tilgjengelig."}
                accentClassName="bg-[color:var(--fb-season-solid)]"
                onToggle={onTogglePropertyLayer}
                disabled={!hasProperties}
              />
              <LayerToggle
                active={showSoilLayer}
                label="Jordsmonn"
                status={soilStatus}
                accentClassName="bg-[color:var(--fb-accent-success)]"
                onToggle={onToggleSoilLayer}
              />
              <LayerToggle
                active={showForestLayer}
                label="Naturskogindikasjon"
                status={forestStatus}
                accentClassName="bg-[color:var(--fb-map-forest)]"
                onToggle={onToggleForestLayer}
              />
            </div>

            <p className="mt-3 px-1 text-xs leading-5 text-fb-text-secondary">
              Flere kartvalg ligger under innstillinger i sidepanelet.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
