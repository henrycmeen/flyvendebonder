import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, CloudSun, Flower2, Leaf, Snowflake, Sun } from "lucide-react";

import { captureTimelineState, formatCaptureDate, type CaptureDate } from "@/lib/capture-timeline";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";

interface FilterPanelProps {
  mapTools?: ReactNode;
  selectedYear: string;
  selectedSeason: SeasonFilter;
  availableYears: string[];
  seasonCounts: {
    spring: number;
    summer: number;
    autumn: number;
    winter: number;
  };
  onYearChange: (year: string) => void;
  onSeasonChange: (season: SeasonFilter) => void;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  dates?: CaptureDate[];
  selectedDate?: string | null;
  dayScope?: "all" | "selected";
  onSelectIndex?: (index: number) => void;
  onDayScopeChange?: (scope: "all" | "selected") => void;
}

const seasonButtons: Array<{
  key: SeasonFilter;
  label: string;
  icon: typeof Flower2;
}> = [
  { key: "all", label: "Hele året", icon: CloudSun },
  { key: "spring", label: "Vår", icon: Flower2 },
  { key: "summer", label: "Sommer", icon: Sun },
  { key: "autumn", label: "Høst", icon: Leaf },
  { key: "winter", label: "Vinter", icon: Snowflake },
];

export function FilterPanel({
  mapTools,
  selectedYear,
  selectedSeason,
  availableYears,
  seasonCounts,
  onYearChange,
  onSeasonChange,
  expanded: controlledExpanded,
  onExpandedChange,
  dates = [],
  selectedDate,
  dayScope = "all",
  onSelectIndex,
  onDayScopeChange,
}: FilterPanelProps) {
  const [localExpanded, setLocalExpanded] = useState(false);
  const expanded = controlledExpanded ?? localExpanded;
  const setExpanded = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    const next = typeof value === "function" ? value(expanded) : value;
    if (controlledExpanded === undefined) setLocalExpanded(next);
    onExpandedChange?.(next);
  }, [controlledExpanded, expanded, onExpandedChange]);
  const panelId = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const timeline = useMemo(() => captureTimelineState(dates, selectedDate), [dates, selectedDate]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const seasonMeta = useMemo(() => {
    if (selectedSeason === "spring") return { label: "Vår", Icon: Flower2 };
    if (selectedSeason === "summer") return { label: "Sommer", Icon: Sun };
    if (selectedSeason === "autumn") return { label: "Høst", Icon: Leaf };
    if (selectedSeason === "winter") return { label: "Vinter", Icon: Snowflake };
    return { label: "Hele året", Icon: CloudSun };
  }, [selectedSeason]);

  const years = useMemo(() => ["all", ...availableYears], [availableYears]);
  const yearLabel = selectedYear === "all" ? "Alle" : selectedYear;
  const selectedChipClass =
    "border-[color:color-mix(in_srgb,var(--fb-season-solid)_18%,rgba(255,255,255,0.4))] bg-[color:color-mix(in_srgb,var(--fb-season-solid)_14%,white)] text-fb-text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.42)]";
  const idleChipClass =
    "border-white/8 bg-white/[0.03] text-fb-text-primary hover:bg-white/[0.08] hover:border-white/14";

  useEffect(() => {
    if (!expanded) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-fb-map-filter-trigger]")) return;
      if (!rootRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
        if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded, setExpanded]);

  return (
    <div
      ref={rootRef}
      className="fb-filter-anchor pointer-events-none absolute bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.5rem))] left-1/2 z-[860] w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] -translate-x-1/2 sm:bottom-4 sm:left-4 sm:w-auto sm:max-w-[calc(100vw-1.5rem)] sm:translate-x-0"
    >
      <Card
        data-expanded={expanded}
        className={cn(
          "fb-liquid-filter pointer-events-auto overflow-hidden rounded-[24px] transition-[width,border-radius,box-shadow,transform] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
          expanded ? "w-full sm:w-[min(640px,calc(100vw-1.5rem))]" : "w-[min(15.75rem,calc(100vw-1rem))] sm:w-[256px]",
        )}
      >
        <CardContent className="p-0">
          <button
            ref={triggerRef}
            type="button"
            className="fb-liquid-filter__bar flex w-full items-center gap-3 px-3.5 py-3 text-left"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={expanded ? "Lukk filtre" : "Åpne filtre"}
            aria-controls={panelId}
          >
            <span
              className="fb-filter-season-icon inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[color:var(--fb-text-primary)] transition-transform duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)]"
              style={{ color: "color-mix(in srgb, var(--fb-season-solid) 72%, var(--fb-text-primary))" }}
            >
              <seasonMeta.Icon className="h-7 w-7" strokeWidth={2.25} />
            </span>

            <span className="fb-filter-summary min-w-0 flex-1">
              <span className="block text-[1.2rem] font-semibold leading-none tracking-[-0.05em] text-[color:var(--fb-season-solid)] transition-[font-size] duration-[var(--fb-motion-duration-medium)] sm:text-[1.3rem]">
                {yearLabel}
              </span>
              <span className="mt-0.5 block text-[0.76rem] font-semibold uppercase tracking-[0.05em] text-fb-text-primary">
                {seasonMeta.label}
              </span>
              {dayScope === "selected" && timeline.selected && <span className="fb-filter-day mt-1 block text-xs text-fb-text-secondary">{formatCaptureDate(timeline.selected.date, true)}</span>}
            </span>

            <span className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-fb-text-secondary md:inline-flex">
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)]",
                  expanded && "rotate-180",
                )}
              />
            </span>
          </button>

          <div
            className={cn(
              "grid transition-[grid-template-rows,opacity] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
              expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}
          >
            <div id={panelId} className="overflow-hidden" inert={!expanded} aria-hidden={!expanded}>
              <div className="fb-liquid-filter__panel max-h-[65dvh] overflow-y-auto px-4 pb-4 pt-2">
                {mapTools && <div className="fb-mobile-map-tools" aria-label="Kartverktøy">{mapTools}</div>}
                <div className="space-y-3">
                  <div
                    className={cn(
                      "space-y-2 transition-[opacity,transform] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
                      expanded ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
                    )}
                    style={{ transitionDelay: expanded ? "40ms" : "0ms" }}
                  >
                    <div className="flex flex-wrap gap-2">
                      {years.map((year) => {
                        const selected = selectedYear === year;
                        const label = year === "all" ? "Alle" : year;
                        return (
                          <button
                            key={year}
                            type="button"
                            className={cn(
                              "fb-filter-choice rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,transform,box-shadow] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected ? selectedChipClass : idleChipClass,
                            )}
                            aria-pressed={selected}
                            onClick={() => onYearChange(year)}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div
                    className={cn(
                      "space-y-2 transition-[opacity,transform] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
                      expanded ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
                    )}
                    style={{ transitionDelay: expanded ? "90ms" : "0ms" }}
                  >
                    <div className="flex flex-wrap gap-2">
                      {seasonButtons.map((item) => {
                        const Icon = item.icon;
                        const disabled = item.key !== "all" && seasonCounts[item.key] === 0;
                        const selected = selectedSeason === item.key;
                        return (
                          <button
                            key={item.key}
                            type="button"
                            disabled={disabled}
                            className={cn(
                              "fb-filter-choice inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,opacity,transform,box-shadow] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected ? selectedChipClass : idleChipClass,
                              disabled && "cursor-not-allowed opacity-40",
                            )}
                            aria-pressed={selected}
                            onClick={() => onSeasonChange(item.key)}
                          >
                            <Icon
                              className={cn(
                                "h-4 w-4",
                                selected ? "text-[color:color-mix(in_srgb,var(--fb-season-solid)_78%,var(--fb-text-primary))]" : "text-fb-text-secondary",
                              )}
                              strokeWidth={2.1}
                            />
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {onSelectIndex && onDayScopeChange && (
                    <section className="space-y-2 border-t border-white/20 pt-3" aria-label="Opptaksdatoer">
                      <p className="text-xs font-semibold text-fb-text-secondary">
                        Opptaksdager · {timeline.dates.length}
                      </p>
                      <div className="flex flex-wrap gap-2" role="group" aria-label="Velg opptaksdag">
                        <button
                          type="button"
                          className={cn("fb-filter-choice min-h-11 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors", dayScope === "all" ? selectedChipClass : idleChipClass)}
                          aria-pressed={dayScope === "all"}
                          onClick={() => onDayScopeChange("all")}
                        >
                          Alle datoer
                        </button>
                        {timeline.dates.map((entry) => {
                          const selected = dayScope === "selected" && selectedDate === entry.date;
                          const dateLabel = new Intl.DateTimeFormat("nb-NO", {
                            day: "numeric",
                            month: "short",
                            ...(selectedYear === "all" ? { year: "numeric" as const } : {}),
                            timeZone: "UTC",
                          }).format(new Date(`${entry.date}T00:00:00Z`));
                          return (
                            <button
                              key={entry.date}
                              type="button"
                              data-capture-date={entry.date}
                              className={cn("fb-filter-choice inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors", selected ? selectedChipClass : idleChipClass)}
                              aria-pressed={selected}
                              aria-label={`Velg ${formatCaptureDate(entry.date)} · ${entry.count} ${entry.count === 1 ? "bilde" : "bilder"} i arkivet`}
                              title={`${entry.count} ${entry.count === 1 ? "bilde" : "bilder"}`}
                              onClick={() => onSelectIndex(entry.index)}
                            >
                              {dateLabel}
                              <span className="text-xs font-normal text-fb-text-secondary">· {entry.count}</span>
                            </button>
                          );
                        })}
                      </div>
                      {!timeline.dates.length && <p className="text-xs text-fb-text-secondary">Ingen opptak i dette utvalget.</p>}
                    </section>
                  )}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
