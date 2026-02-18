import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Flower2, Leaf, MoveHorizontal, Snowflake, Sun } from "lucide-react";

import type { TimelineDate } from "@/types";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";
type DayScope = "all" | "selected";
type UiTheme = "standard" | "satellite";

interface TimelineDateIndexed extends TimelineDate {
  index: number;
  year: string;
  month: string;
  season: Exclude<SeasonFilter, "all">;
}

interface TimelineBottomProps {
  filteredDates: TimelineDateIndexed[];
  uiTheme: UiTheme;
  selectedIndex: number;
  selectedYear: string;
  selectedSeason: SeasonFilter;
  dayScope: DayScope;
  availableYears: string[];
  seasonCounts: {
    spring: number;
    summer: number;
    autumn: number;
    winter: number;
  };
  onSelectIndex: (next: number) => void;
  onYearChange: (year: string) => void;
  onSeasonChange: (season: SeasonFilter) => void;
  onDayScopeChange: (scope: DayScope) => void;
}

const formatDate = (value: string) =>
  new Date(`${value}T00:00:00`).toLocaleDateString("nb-NO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

const seasonLabels: Record<Exclude<SeasonFilter, "all">, string> = {
  spring: "Vår",
  summer: "Sommer",
  autumn: "Høst",
  winter: "Vinter",
};

const seasonButtons: Array<{
  key: Exclude<SeasonFilter, "all">;
  label: string;
  icon: typeof Flower2;
}> = [
  { key: "spring", label: "Vår", icon: Flower2 },
  { key: "summer", label: "Sommer", icon: Sun },
  { key: "autumn", label: "Høst", icon: Leaf },
  { key: "winter", label: "Vinter", icon: Snowflake },
];

function barWidth(entry: TimelineDate, maxCount: number): number {
  if (maxCount <= 0) return 28;
  const ratio = Math.max(0.18, entry.count / maxCount);
  return Math.round(16 + ratio * 34);
}

export function TimelineBottom({
  filteredDates,
  uiTheme,
  selectedIndex,
  selectedYear,
  selectedSeason,
  dayScope,
  availableYears,
  seasonCounts,
  onSelectIndex,
  onYearChange,
  onSeasonChange,
  onDayScopeChange,
}: TimelineBottomProps) {
  const [isExpanded, setIsExpanded] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 1024px)").matches;
  });
  const [showYearScrollHint, setShowYearScrollHint] = useState(false);
  const [yearCanScrollLeft, setYearCanScrollLeft] = useState(false);
  const [yearCanScrollRight, setYearCanScrollRight] = useState(false);
  const yearRowRef = useRef<HTMLDivElement | null>(null);
  const maxCount = filteredDates.reduce((max, entry) => Math.max(max, entry.count), 0);
  const hasData = filteredDates.length > 0;

  const updateYearScrollHint = useCallback(() => {
    const node = yearRowRef.current;
    if (!node) {
      setShowYearScrollHint(false);
      setYearCanScrollLeft(false);
      setYearCanScrollRight(false);
      return;
    }
    const maxScrollLeft = Math.max(0, node.scrollWidth - node.clientWidth);
    const isOverflowing = maxScrollLeft > 8;
    const canScrollLeft = isOverflowing && node.scrollLeft > 4;
    const canScrollRight = isOverflowing && node.scrollLeft < maxScrollLeft - 4;
    setShowYearScrollHint(isOverflowing);
    setYearCanScrollLeft(canScrollLeft);
    setYearCanScrollRight(canScrollRight);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateYearScrollHint);
    window.addEventListener("resize", updateYearScrollHint);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateYearScrollHint);
    };
  }, [availableYears, updateYearScrollHint]);

  return (
    <Card
      className={cn(
        "timeline-bottom pointer-events-auto fixed bottom-3 left-1/2 z-[890] w-[min(78vw,1080px)] max-w-[calc(100vw-30px)] -translate-x-1/2 overflow-hidden rounded-[24px] sm:max-w-[calc(100vw-40px)]",
        uiTheme === "satellite" && "timeline-bottom--satellite",
      )}
    >
      <CardContent className={cn("px-4 sm:px-5", isExpanded ? "space-y-2.5 py-3 sm:py-4" : "py-2.5 sm:py-3")}>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={cn(
              "inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full border transition-colors",
              uiTheme === "satellite"
                ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
            )}
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-expanded={isExpanded}
            aria-label={isExpanded ? "Skjul filtre" : "Vis filtre"}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>

          <div className="relative min-w-0 flex-1">
            {yearCanScrollLeft ? (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 z-[1] w-6",
                  uiTheme === "satellite"
                    ? "bg-gradient-to-r from-black/28 to-transparent"
                    : "bg-gradient-to-r from-paper/80 to-transparent",
                )}
              />
            ) : null}
            {yearCanScrollRight ? (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 right-0 z-[1] w-6",
                  uiTheme === "satellite"
                    ? "bg-gradient-to-l from-black/28 to-transparent"
                    : "bg-gradient-to-l from-paper/80 to-transparent",
                )}
              />
            ) : null}

            <div
              ref={yearRowRef}
              className="overflow-x-auto px-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              onScroll={updateYearScrollHint}
            >
              <div className="mx-auto w-fit">
                <ul className="flex min-w-max items-center gap-1.5 pb-1">
                  <li>
                    <button
                      type="button"
                      className={cn(
                        "rounded-full border px-4 py-1.5 text-[20px] leading-none font-semibold transition-colors",
                        selectedYear === "all"
                          ? "border-transparent bg-[#141414] text-white"
                          : uiTheme === "satellite"
                            ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                            : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
                      )}
                      onClick={() => onYearChange("all")}
                    >
                      Alle
                    </button>
                  </li>
                  {availableYears.map((year) => (
                    <li key={year}>
                      <button
                        type="button"
                        className={cn(
                          "rounded-full border px-4 py-1.5 text-[20px] leading-none font-semibold transition-colors",
                          selectedYear === year
                            ? "border-transparent bg-[#141414] text-white"
                            : uiTheme === "satellite"
                              ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                              : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
                        )}
                        onClick={() => onYearChange(year)}
                        aria-current={selectedYear === year ? "true" : undefined}
                      >
                        {year}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>

        {isExpanded && showYearScrollHint ? (
          <p
            className={cn(
              "flex items-center justify-center gap-1 text-center text-[11px]",
              uiTheme === "satellite" ? "text-white/76" : "text-earth-700/85",
            )}
          >
            <MoveHorizontal className="h-3.5 w-3.5" />
            Sveip for flere år
          </p>
        ) : null}

        {isExpanded ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="mx-auto flex w-fit flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-base font-medium transition-colors",
                    selectedSeason === "all"
                      ? "border-transparent bg-earth-900 text-white"
                      : uiTheme === "satellite"
                        ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                        : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
                  )}
                  onClick={() => onSeasonChange("all")}
                >
                  Hele året
                </button>

                {seasonButtons.map((item) => {
                  const Icon = item.icon;
                  const count = seasonCounts[item.key];
                  const disabled = count === 0;
                  const active = selectedSeason === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-4 text-base font-medium transition-colors",
                        active
                          ? "border-transparent bg-earth-900 text-white"
                          : uiTheme === "satellite"
                            ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                            : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
                        disabled && "cursor-not-allowed opacity-40 hover:bg-paper/75",
                      )}
                      onClick={() => onSeasonChange(item.key)}
                      disabled={disabled}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="overflow-x-auto">
              {hasData ? (
                <div className="mx-auto flex min-w-max w-fit items-center gap-2 pb-1 pt-0.5">
                  <button
                    type="button"
                    className={cn(
                      "h-7 shrink-0 rounded-full border px-3 text-xs font-semibold transition-colors",
                      dayScope === "all"
                        ? "border-transparent bg-[#141414] text-white"
                        : uiTheme === "satellite"
                          ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                          : "border-earth-500/30 bg-paper/75 text-earth-900 hover:bg-paper",
                    )}
                    onClick={() => onDayScopeChange("all")}
                  >
                    Alle dager
                  </button>

                  <ul className="flex items-center gap-3">
                    {filteredDates.map((entry) => {
                      const active = entry.index === selectedIndex;
                      const width = barWidth(entry, maxCount);
                      return (
                        <li key={entry.date} className="shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="block h-2.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-earth-700"
                                style={{
                                  width: `${width}px`,
                                  backgroundColor: active ? "#141414" : uiTheme === "satellite" ? "rgba(242, 230, 211, 0.62)" : "#d5d5d5",
                                }}
                                onClick={() => onSelectIndex(entry.index)}
                                aria-label={`Velg ${formatDate(entry.date)}`}
                                aria-current={active ? "date" : undefined}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top">
                              {formatDate(entry.date)} · {entry.count} bilder · {seasonLabels[entry.season]}
                            </TooltipContent>
                          </Tooltip>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2 py-1">
                  <p className="text-xs text-earth-700">Ingen bilder for valgt år/sesong.</p>
                  <button
                    type="button"
                    className={cn(
                      "inline-flex h-7 items-center rounded-full border px-3 text-xs font-semibold transition-colors",
                      uiTheme === "satellite"
                        ? "border-black/25 bg-black/24 text-white hover:bg-black/32"
                        : "border-earth-500/35 bg-paper/80 text-earth-900 hover:bg-paper",
                    )}
                    onClick={() => {
                      onYearChange("all");
                      onSeasonChange("all");
                      onDayScopeChange("all");
                    }}
                  >
                    Vis alle bilder
                  </button>
                </div>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
