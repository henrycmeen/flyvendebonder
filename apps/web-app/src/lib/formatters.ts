import type { Property } from "@/types";

export type SeasonLike = "all" | "spring" | "summer" | "autumn" | "winter";
export type DayScopeLike = "all" | "selected";

export function formatPropertyReference(
  property: Pick<Property, "komm" | "gnr" | "bnr" | "fnr">,
): string {
  return `${property.komm}-${property.gnr}/${property.bnr}/${property.fnr}`;
}

export interface ManualViewTarget {
  lat: number;
  lng: number;
}

export function seasonLabel(season: SeasonLike): string {
  if (season === "spring") return "Vår";
  if (season === "summer") return "Sommer";
  if (season === "autumn") return "Høst";
  if (season === "winter") return "Vinter";
  return "Hele året";
}

export function splitCapturedDate(value: string): { year: string; month: string } | null {
  if (typeof value !== "string" || value.length < 7) return null;
  return {
    year: value.slice(0, 4),
    month: value.slice(5, 7),
  };
}

export function buildPhotoStatusText(
  count: number,
  year: string,
  season: SeasonLike,
  dayScope: DayScopeLike,
  selectedDate: string | null,
): string {
  const yearText = year === "all" ? "alle år" : `år ${year}`;
  const seasonText = seasonLabel(season).toLowerCase();
  const dayText = dayScope === "all" ? "alle dager" : selectedDate ? `dag ${selectedDate}` : "valgt dag";
  return `${count} bilder vist (${yearText}, ${seasonText}, ${dayText})`;
}

export function formatCapturedAt(value: string): string {
  try {
    return new Date(value).toLocaleString("nb-NO", {
      dateStyle: "full",
      timeStyle: "short",
      hour12: false,
    });
  } catch {
    return value;
  }
}

export function formatCoordinate(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : "ukjent";
}

export function formatMeters(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${value.toFixed(1)} m`;
}

export function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
}

export function formatGsd(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  return `${(value * 100).toFixed(2)} cm/px`;
}

export function formatConfidence(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "ukjent";
  const normalized = Math.max(0, Math.min(1, value));
  return `${Math.round(normalized * 100)}%`;
}

export function formatQCRating(source: string | null): string {
  if (source == null || source.trim() === "") return "ukjent";
  return source;
}

export function toDraftNumber(value: number | null, decimals = 1): string {
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(decimals);
}

export function parseDraftNumber(value: string): { valid: boolean; value: number | null } {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return { valid: true, value: null };
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return { valid: false, value: null };
  return { valid: true, value: parsed };
}

export function numbersEqual(a: number | null, b: number | null): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.000001;
}

export function parseManualViewTarget(tags: string[] | null | undefined): ManualViewTarget | null {
  if (!tags?.length) return null;
  const latTag = tags.find((tag) => tag.startsWith("meta:manual_view_lat="));
  const lngTag = tags.find((tag) => tag.startsWith("meta:manual_view_lng="));
  if (!latTag || !lngTag) return null;
  const lat = Number(latTag.slice("meta:manual_view_lat=".length));
  const lng = Number(lngTag.slice("meta:manual_view_lng=".length));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function sameManualViewTarget(a: ManualViewTarget | null, b: ManualViewTarget | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 0.000001 && Math.abs(a.lng - b.lng) < 0.000001;
}

export function formatGeometryMethod(value: string | null): string {
  if (value === "estimated") return "estimert";
  if (value === "point") return "punkt";
  if (value === "manual") return "manuell";
  return "ikke satt";
}

export function getAnalysisConfidenceTone(confidence: number | null): "good" | "medium" | "low" | "none" {
  if (confidence == null) return "none";
  if (confidence >= 0.75) return "good";
  if (confidence >= 0.6) return "medium";
  return "low";
}

export function getAnalysisToneText(confidence: number | null): string {
  if (confidence == null) return "Mangler verdi";
  const tone = getAnalysisConfidenceTone(confidence);
  if (tone === "good") return "Høy";
  if (tone === "medium") return "Middels";
  return "Lav";
}

export function toLogDetails(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeTagsInput(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  values.forEach((value) => {
    const tag = value.trim();
    if (!tag) return;
    const key = tag.toLocaleLowerCase("nb-NO");
    if (seen.has(key)) return;
    seen.add(key);
    result.push(tag.slice(0, 72));
  });
  return result;
}
