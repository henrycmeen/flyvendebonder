import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CloudSun, Flower2, Leaf, Snowflake, Sun } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";

interface FilterPanelProps {
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
  onExpandedChange?: (expanded: boolean) => void;
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
  selectedYear,
  selectedSeason,
  availableYears,
  seasonCounts,
  onYearChange,
  onSeasonChange,
  onExpandedChange,
}: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
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
      if (!rootRef.current?.contains(event.target as Node)) {
        setExpanded(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [expanded]);

  useEffect(() => {
    onExpandedChange?.(expanded);
  }, [expanded, onExpandedChange]);

  return (
    <div ref={rootRef} className="pointer-events-none absolute bottom-3 left-3 z-[860] max-w-[calc(100vw-1.5rem)] sm:bottom-4 sm:left-4">
      <Card
        className={cn(
          "fb-liquid-filter pointer-events-auto overflow-hidden rounded-[24px] transition-[width,border-radius,box-shadow,transform] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
          expanded ? "w-[min(640px,calc(100vw-1.5rem))]" : "w-[236px] sm:w-[256px]",
        )}
      >
        <CardContent className="p-0">
          <button
            type="button"
            className="fb-liquid-filter__bar flex w-full items-center gap-3 px-3.5 py-3 text-left"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label="Åpne filtre"
          >
            <span
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-[color:var(--fb-text-primary)] transition-transform duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)]"
              style={{ color: "color-mix(in srgb, var(--fb-season-solid) 72%, var(--fb-text-primary))" }}
            >
              <seasonMeta.Icon className="h-7 w-7" strokeWidth={2.25} />
            </span>

            <span className="min-w-0 flex-1">
              <span className="block text-[1.2rem] font-semibold leading-none tracking-[-0.05em] text-[color:var(--fb-season-solid)] transition-[font-size] duration-[var(--fb-motion-duration-medium)] sm:text-[1.3rem]">
                {yearLabel}
              </span>
              <span className="mt-0.5 block text-[0.76rem] font-semibold uppercase tracking-[0.05em] text-fb-text-primary">
                {seasonMeta.label}
              </span>
            </span>

            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-fb-text-secondary">
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
            <div className="overflow-hidden">
              <div className="fb-liquid-filter__panel px-4 pb-4 pt-2">
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
                              "rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,transform,box-shadow] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected ? selectedChipClass : idleChipClass,
                            )}
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
                              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,opacity,transform,box-shadow] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected ? selectedChipClass : idleChipClass,
                              disabled && "cursor-not-allowed opacity-40",
                            )}
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
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
