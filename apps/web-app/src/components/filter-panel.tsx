import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { captureTimelineState, formatCaptureDate, type CaptureDate } from "@/lib/capture-timeline";
import "./capture-timeline.css";

type SeasonFilter = "all" | "spring" | "summer" | "autumn" | "winter";
interface FilterPanelProps {
  selectedYear: string;
  selectedSeason: SeasonFilter;
  availableYears: string[];
  seasonCounts: { spring: number; summer: number; autumn: number; winter: number };
  onYearChange: (year: string) => void;
  onSeasonChange: (season: SeasonFilter) => void;
  onExpandedChange?: (expanded: boolean) => void;
  dates?: CaptureDate[];
  selectedDate?: string | null;
  dayScope?: "all" | "selected";
  onSelectIndex?: (index: number) => void;
  onDayScopeChange?: (scope: "all" | "selected") => void;
}
const seasons: { key: SeasonFilter; label: string }[] = [
  { key: "all", label: "Hele året" }, { key: "spring", label: "Vår" },
  { key: "summer", label: "Sommer" }, { key: "autumn", label: "Høst" },
  { key: "winter", label: "Vinter" },
];
const emptyDates: CaptureDate[] = [];

export function FilterPanel({ selectedYear, selectedSeason, availableYears, seasonCounts,
  onYearChange, onSeasonChange, onExpandedChange, dates = emptyDates, selectedDate,
  dayScope = "all", onSelectIndex, onDayScopeChange }: FilterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const timeline = useMemo(() => captureTimelineState(dates, selectedDate), [dates, selectedDate]);
  const maxCount = Math.max(1, ...timeline.dates.map((entry) => entry.count));
  const seasonLabel = seasons.find((season) => season.key === selectedSeason)?.label;
  const scopeLabel = dayScope === "selected"
    ? timeline.selected
      ? `${formatCaptureDate(timeline.selected.date, true)} · ${timeline.selected.count} bilder i arkivet`
      : "Valgt dato finnes ikke i utvalget"
    : `Alle datoer · ${timeline.photoCount} bilder i arkivet`;
  const chooseDate = (entry: CaptureDate | null) => {
    if (!entry || !onSelectIndex) return;
    onSelectIndex(entry.index);
    onDayScopeChange?.("selected");
  };

  useEffect(() => { onExpandedChange?.(expanded); }, [expanded, onExpandedChange]);
  useEffect(() => {
    const revealSelection = () => selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    revealSelection();
    window.addEventListener("resize", revealSelection);
    return () => window.removeEventListener("resize", revealSelection);
  }, [expanded, selectedDate, dates]);
  useEffect(() => {
    if (!expanded) return;
    const pointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpanded(false);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (rootRef.current?.contains(document.activeElement)) triggerRef.current?.focus();
        setExpanded(false);
      }
    };
    window.addEventListener("pointerdown", pointer);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("pointerdown", pointer);
      window.removeEventListener("keydown", keyboard);
    };
  }, [expanded]);

  return <div ref={rootRef} className="fb-capture-timeline" data-expanded={expanded}>
    <div className="fb-capture-timeline__header">
      <button ref={triggerRef} type="button" className="fb-capture-timeline__summary"
        aria-expanded={expanded} aria-controls={panelId}
        aria-label={`${expanded ? "Lukk" : "Åpne"} opptaksfiltre. ${timeline.range}. ${scopeLabel}`}
        onClick={() => setExpanded((value) => !value)}>
        <CalendarDays size={17} aria-hidden="true" />
        <span>Opptak</span>
        <ChevronDown size={14} className="fb-capture-timeline__chevron" aria-hidden="true" />
      </button>
      <Button variant="ghost" className="fb-capture-timeline__all" aria-pressed={dayScope === "all"}
        disabled={!onDayScopeChange} aria-label={`Vis alle datoer, ${timeline.photoCount} bilder i arkivet`}
        onClick={() => onDayScopeChange?.("all")}>Alle datoer</Button>
      <div className="fb-capture-timeline__navigation">
        <Button variant="ghost" size="icon" aria-label="Forrige opptaksdato" disabled={!timeline.previous || !onSelectIndex}
          onClick={() => chooseDate(timeline.previous)}><ChevronLeft size={17} /></Button>
        <Button variant="ghost" size="icon" aria-label="Neste opptaksdato" disabled={!timeline.next || !onSelectIndex}
          onClick={() => chooseDate(timeline.next)}><ChevronRight size={17} /></Button>
      </div>
    </div>
    <div className="fb-capture-timeline__dates" role="group" aria-label="Opptaksdatoer, fra eldste til nyeste">
      {timeline.dates.map((entry, position) => {
        const current = entry.date === selectedDate;
        const month = Number(entry.date.slice(5, 7));
        const season = month >= 3 && month <= 5 ? "spring" : month >= 6 && month <= 8 ? "summer"
          : month >= 9 && month <= 11 ? "autumn" : "winter";
        const firstInYear = position === 0 || timeline.dates[position - 1].date.slice(0, 4) !== entry.date.slice(0, 4);
        const weight = Math.sqrt(Math.max(0, entry.count) / maxCount);
        return <button key={entry.date} ref={current ? selectedRef : undefined} type="button"
          className="fb-capture-timeline__date" data-season={season}
          style={{ "--capture-size": `${9 + weight * 11}px`, "--capture-stem": `${3 + weight * 9}px` } as CSSProperties}
          aria-current={current ? "date" : undefined} aria-pressed={current && dayScope === "selected"}
          disabled={!onSelectIndex}
          aria-label={`${formatCaptureDate(entry.date)}, ${entry.count} bilder i arkivet${current ? ", gjeldende dato" : ""}`}
          title={`${formatCaptureDate(entry.date)} · ${entry.count} bilder i arkivet`}
          onClick={() => chooseDate(entry)}>
          <span className="fb-capture-timeline__year" aria-hidden="true">{firstInYear ? entry.date.slice(0, 4) : " "}</span>
          <span className="fb-capture-timeline__bead-space" aria-hidden="true"><span className="fb-capture-timeline__stem" /><span className="fb-capture-timeline__bead" /></span>
          <span className="fb-capture-timeline__date-label" aria-hidden="true">{formatCaptureDate(entry.date, true).replace(/\s+\d{4}$/, "")}</span>
          <span className="fb-capture-timeline__count" aria-hidden="true">{entry.count}</span>
        </button>;
      })}
      {timeline.dates.length === 0 && <p className="fb-capture-timeline__empty">Ingen opptak i utvalget. Åpne filtrene for å velge år eller årstid.</p>}
    </div>
    {expanded && <div id={panelId} className="fb-capture-timeline__panel">
      <div className="fb-capture-timeline__filters">
        <label>År<NativeSelect aria-label="År" value={selectedYear} onChange={(event) => onYearChange(event.target.value)}>
          <option value="all">Alle år</option>
          {availableYears.filter((year) => year !== "all").map((year) => <option key={year} value={year}>{year}</option>)}
        </NativeSelect></label>
        <label>Årstid<NativeSelect aria-label="Årstid" value={selectedSeason} onChange={(event) => onSeasonChange(event.target.value as SeasonFilter)}>
          {seasons.map((season) => <option key={season.key} value={season.key}
            disabled={season.key !== "all" && seasonCounts[season.key] === 0}>{season.label}</option>)}
        </NativeSelect></label>
      </div>
      <div className="fb-capture-timeline__scope" role="group" aria-label="Hvilke opptak vises">
        <Button variant="outline" aria-pressed={dayScope === "all"} disabled={!onDayScopeChange}
          onClick={() => onDayScopeChange?.("all")}>Alle datoer</Button>
        <Button variant="outline" aria-pressed={dayScope === "selected"} disabled={!timeline.selected || !onDayScopeChange}
          onClick={() => onDayScopeChange?.("selected")}>Valgt dato</Button>
      </div>
      <p className="fb-capture-timeline__details">{selectedYear === "all" ? "Alle år" : selectedYear} · {seasonLabel} · {timeline.range} · {timeline.dates.length} datoer · {scopeLabel}</p>
      <p className="fb-capture-timeline__qualification">Antall i arkivet. Kartet viser innlastede bilder som passer filtrene.</p>
    </div>}
  </div>;
}
