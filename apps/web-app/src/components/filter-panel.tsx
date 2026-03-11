import { useMemo, useState } from "react";
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
}: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const seasonMeta = useMemo(() => {
    if (selectedSeason === "spring") return { label: "Vår", Icon: Flower2 };
    if (selectedSeason === "summer") return { label: "Sommer", Icon: Sun };
    if (selectedSeason === "autumn") return { label: "Høst", Icon: Leaf };
    if (selectedSeason === "winter") return { label: "Vinter", Icon: Snowflake };
    return { label: "Hele året", Icon: CloudSun };
  }, [selectedSeason]);

  const years = useMemo(() => ["all", ...availableYears], [availableYears]);
  const yearLabel = selectedYear === "all" ? "Alle" : selectedYear;

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 z-[860] sm:bottom-4 sm:left-4">
      <Card
        className={cn(
          "fb-liquid-filter pointer-events-auto overflow-hidden rounded-[26px] transition-[width,border-radius,box-shadow] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
          expanded ? "w-[min(720px,calc(100vw-1.5rem))]" : "w-[272px] sm:w-[292px]",
        )}
      >
        <CardContent className="p-0">
          <button
            type="button"
            className="fb-liquid-filter__bar flex w-full items-center gap-3 px-4 py-3 text-left"
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
              <span className="block text-[1.35rem] font-semibold leading-none tracking-[-0.05em] text-[color:var(--fb-season-solid)] transition-[font-size] duration-[var(--fb-motion-duration-medium)] sm:text-[1.5rem]">
                {yearLabel}
              </span>
              <span className="mt-0.5 block text-[0.8rem] font-semibold uppercase tracking-[0.04em] text-fb-text-primary">
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
              <div className="fb-liquid-filter__panel px-4 pb-4 pt-3">
                <div className="space-y-4">
                  <div
                    className={cn(
                      "space-y-2 transition-[opacity,transform] duration-[var(--fb-motion-duration-large)] ease-[var(--fb-motion-easing-standard)]",
                      expanded ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0",
                    )}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Årstall</p>
                    <div className="flex flex-wrap gap-2">
                      {years.map((year) => {
                        const selected = selectedYear === year;
                        const label = year === "all" ? "Alle" : year;
                        return (
                          <button
                            key={year}
                            type="button"
                            className={cn(
                              "rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,transform] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected
                                ? "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)] text-[color:var(--fb-chip-active-text)]"
                                : "border-white/22 bg-white/10 text-fb-text-primary hover:bg-white/18",
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
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fb-text-muted">Årstid</p>
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
                              "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-[background-color,color,border-color,opacity,transform] duration-[var(--fb-motion-duration-medium)] ease-[var(--fb-motion-easing-standard)] hover:scale-[1.01]",
                              selected
                                ? "border-[color:var(--fb-season-solid)] bg-[color:var(--fb-season-solid)] text-[color:var(--fb-chip-active-text)]"
                                : "border-white/22 bg-white/10 text-fb-text-primary hover:bg-white/18",
                              disabled && "cursor-not-allowed opacity-40",
                            )}
                            onClick={() => onSeasonChange(item.key)}
                          >
                            <Icon className="h-4 w-4" strokeWidth={2.1} />
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
