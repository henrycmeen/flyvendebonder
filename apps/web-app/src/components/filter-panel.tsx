import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
    if (expanded) selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
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
    <button ref={triggerRef} type="button" className="fb-capture-timeline__summary"
      aria-expanded={expanded} aria-controls={panelId}
      aria-label={`${expanded ? "Lukk" : "Åpne"} opptakstidslinje. ${timeline.range}. ${scopeLabel}`}
      onClick={() => setExpanded((value) => !value)}>
      <CalendarDays size={21} aria-hidden="true" />
      <span className="fb-capture-timeline__summary-copy">
        <span className="fb-capture-timeline__eyebrow">Opptak · {selectedYear === "all" ? "Alle år" : selectedYear} · {seasonLabel}</span>
        <strong>{timeline.range}</strong>
        <span className="fb-capture-timeline__metadata">{timeline.dates.length} {timeline.dates.length === 1 ? "dato" : "datoer"} · {scopeLabel}</span>
      </span>
      <ChevronDown size={17} className="fb-capture-timeline__chevron" aria-hidden="true" />
    </button>
    {expanded && <div id={panelId} className="fb-capture-timeline__panel">
      <div className="fb-capture-timeline__filters">
        <label>År<select value={selectedYear} onChange={(event) => onYearChange(event.target.value)}>
          <option value="all">Alle år</option>
          {availableYears.filter((year) => year !== "all").map((year) => <option key={year} value={year}>{year}</option>)}
        </select></label>
        <label>Årstid<select value={selectedSeason} onChange={(event) => onSeasonChange(event.target.value as SeasonFilter)}>
          {seasons.map((season) => <option key={season.key} value={season.key}
            disabled={season.key !== "all" && seasonCounts[season.key] === 0}>{season.label}</option>)}
        </select></label>
      </div>
      <div className="fb-capture-timeline__scope" role="group" aria-label="Hvilke opptak vises">
        <Button variant="outline" aria-pressed={dayScope === "all"} disabled={!onDayScopeChange}
          onClick={() => onDayScopeChange?.("all")}>Alle datoer</Button>
        <Button variant="outline" aria-pressed={dayScope === "selected"} disabled={!timeline.selected || !onDayScopeChange}
          onClick={() => onDayScopeChange?.("selected")}>Valgt dato</Button>
      </div>
      <div className="fb-capture-timeline__navigation">
        <span>{dayScope === "selected" ? "Velg opptaksdato" : "Velg en dato for å vise dagens bilder"}</span>
        <div>
          <Button variant="outline" size="icon" aria-label="Forrige opptaksdato" disabled={!timeline.previous || !onSelectIndex}
            onClick={() => chooseDate(timeline.previous)}><ChevronLeft size={18} /></Button>
          <Button variant="outline" size="icon" aria-label="Neste opptaksdato" disabled={!timeline.next || !onSelectIndex}
            onClick={() => chooseDate(timeline.next)}><ChevronRight size={18} /></Button>
        </div>
      </div>
      <p className="fb-capture-timeline__qualification">Antall bilder i arkivet. Kartet viser innlastede bilder som passer filtrene.</p>
      <div className="fb-capture-timeline__dates" role="group" aria-label="Opptaksdatoer">
        {timeline.dates.map((entry) => {
          const current = entry.date === selectedDate;
          return <button key={entry.date} ref={current ? selectedRef : undefined} type="button"
            className="fb-capture-timeline__date" aria-current={current ? "date" : undefined}
            aria-pressed={current && dayScope === "selected"} disabled={!onSelectIndex}
            aria-label={`${formatCaptureDate(entry.date)}, ${entry.count} bilder i arkivet${current ? ", gjeldende dato" : ""}`}
            onClick={() => chooseDate(entry)}>
            <strong>{formatCaptureDate(entry.date, true)}</strong><span>{entry.count} bilder i arkivet</span>
          </button>;
        })}
        {timeline.dates.length === 0 && <p className="fb-capture-timeline__empty">Ingen opptak i dette utvalget. Prøv et annet år eller en annen årstid.</p>}
      </div>
    </div>}
  </div>;
}
