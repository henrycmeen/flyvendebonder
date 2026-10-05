export interface CaptureDate {
  date: string;
  count: number;
  /** Index in the parent timeline, independent of display order. */
  index: number;
}

/** Calendar dates are UTC-formatted to avoid moving a capture into another day. */
export function formatCaptureDate(date: string, compact = false): string {
  return new Intl.DateTimeFormat("nb-NO", {
    day: "numeric",
    month: compact ? "short" : "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function orderedCaptureDates(dates: CaptureDate[]): CaptureDate[] {
  return dates.filter((entry) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return false;
    const parsed = new Date(`${entry.date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === entry.date;
  }).slice().sort((a, b) => a.date.localeCompare(b.date));
}

export function captureTimelineState(dates: CaptureDate[], selectedDate?: string | null) {
  const ordered = orderedCaptureDates(dates);
  const position = ordered.findIndex((entry) => entry.date === selectedDate);
  return {
    dates: ordered,
    selected: ordered[position] ?? null,
    previous: position > 0 ? ordered[position - 1] : null,
    next: position >= 0 && position < ordered.length - 1 ? ordered[position + 1] : null,
    photoCount: ordered.reduce((sum, entry) => sum + entry.count, 0),
    range: ordered.length === 0 ? "Ingen opptaksdatoer" : ordered.length === 1
      ? formatCaptureDate(ordered[0].date, true)
      : `${formatCaptureDate(ordered[0].date, true)} – ${formatCaptureDate(ordered[ordered.length - 1].date, true)}`,
  };
}

/** A legacy date parameter is a cursor; only explicit scope=day filters the day. */
export function readCaptureScope(params: URLSearchParams): "all" | "selected" {
  const date = params.get("date");
  return params.get("scope") === "day" && date && orderedCaptureDates([{ date, count: 0, index: 0 }]).length > 0
    ? "selected" : "all";
}

export function writeCaptureScope(params: URLSearchParams, dayScope: "all" | "selected", persistDate: boolean): void {
  if (dayScope === "selected" && persistDate) params.set("scope", "day");
  else params.delete("scope");
}
