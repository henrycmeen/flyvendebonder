import type { PhotoFeature } from "../types";

// Accept camera wall-clock timestamps and ISO timestamps with a recorded offset.
// A date alone is not a capture timestamp. Validate fields before Date can normalize them.
const CAPTURE_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

function parseCaptureTimestamp(value: unknown) {
  if (typeof value !== "string") return null;
  const match = CAPTURE_TIMESTAMP.exec(value.trim());
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText = "00", fraction = "", zone] = match;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, 0);
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) return null;

  let offsetMinutes = 0;
  if (zone && zone !== "Z") {
    const digits = zone.slice(1).replace(":", "");
    const offsetHour = Number(digits.slice(0, 2));
    const offsetMinute = Number(digits.slice(2));
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute > 0)) return null;
    offsetMinutes = (zone[0] === "-" ? -1 : 1) * (offsetHour * 60 + offsetMinute);
  }
  // Unknown camera zones use a UTC surrogate for deterministic calendar ordering only.
  // Mixed naive/zoned captures cannot establish absolute chronology without a camera zone.
  const sortTime = calendar.getTime() - offsetMinutes * 60_000 + Number(fraction || 0) * 1000;
  const unknownOffset = !zone || zone === "-00:00" || zone === "-0000";
  const offset = unknownOffset ? null : zone === "Z" ? "+00:00" : zone ? `${zone.slice(0, 3)}:${zone.replace(":", "").slice(3)}` : null;
  return { calendar, sortTime, offset, hourText, minuteText, secondText, fraction };
}

/** Pagination may repeat IDs: retain the first record for each ID and count invalid unique records. */
export function buildCaptureSequence(photos: PhotoFeature[]): { photos: PhotoFeature[]; excludedCount: number } {
  const seen = new Set<string>();
  let excludedCount = 0;
  const valid: { photo: PhotoFeature; sortTime: number }[] = [];
  for (const photo of photos) {
    if (seen.has(photo.id)) continue;
    seen.add(photo.id);
    const timestamp = parseCaptureTimestamp(photo.captured_at);
    if (!timestamp) {
      excludedCount += 1;
      continue;
    }
    valid.push({ photo, sortTime: timestamp.sortTime });
  }
  valid.sort((a, b) => a.sortTime - b.sortTime || (a.photo.id < b.photo.id ? -1 : a.photo.id > b.photo.id ? 1 : 0));
  return { photos: valid.map(({ photo }) => photo), excludedCount };
}

/** Display the recorded camera clock and recorded offset; never assume Europe/Oslo. */
export function formatCaptureTimestamp(value: string): string {
  const parsed = parseCaptureTimestamp(value);
  if (!parsed) return "Ukjent opptakstid";
  const date = new Intl.DateTimeFormat("nb-NO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(parsed.calendar);
  const time = `${parsed.hourText}:${parsed.minuteText}:${parsed.secondText}${parsed.fraction}`;
  return `${date} kl. ${time} (${parsed.offset === null ? "tidssone ukjent" : `UTC${parsed.offset}`})`;
}
