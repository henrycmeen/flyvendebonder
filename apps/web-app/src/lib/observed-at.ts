const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function formatOffset(offsetMinutes: number): string {
  const normalizedOffset = Math.trunc(offsetMinutes);
  const sign = normalizedOffset >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(normalizedOffset);
  return `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

function formatLocalDateTime(date: Date, offsetMinutes: number): string {
  if (Number.isNaN(date.getTime()) || !Number.isFinite(offsetMinutes)) return "";
  const shifted = new Date(date.getTime() + offsetMinutes * 60_000);
  return [
    shifted.getUTCFullYear(),
    "-",
    pad(shifted.getUTCMonth() + 1),
    "-",
    pad(shifted.getUTCDate()),
    "T",
    pad(shifted.getUTCHours()),
    ":",
    pad(shifted.getUTCMinutes()),
  ].join("");
}

export function currentLocalDateTimeInput(
  now = new Date(),
  offsetMinutes = -now.getTimezoneOffset(),
): string {
  return formatLocalDateTime(now, offsetMinutes);
}

export function observedAtInputToRfc3339(
  value: string,
  offsetMinutes?: number,
): string | null {
  const normalizedValue = value.trim();
  if (!normalizedValue) return null;

  const match = LOCAL_DATE_TIME_PATTERN.exec(normalizedValue);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const parts = [year, month, day, hour, minute].map(Number);
  const [yearNumber, monthNumber, dayNumber, hourNumber, minuteNumber] = parts;
  const utcCandidate = new Date(Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber));
  if (
    utcCandidate.getUTCFullYear() !== yearNumber ||
    utcCandidate.getUTCMonth() + 1 !== monthNumber ||
    utcCandidate.getUTCDate() !== dayNumber ||
    utcCandidate.getUTCHours() !== hourNumber ||
    utcCandidate.getUTCMinutes() !== minuteNumber
  ) {
    return null;
  }

  const browserOffset = offsetMinutes ?? -new Date(normalizedValue).getTimezoneOffset();
  if (!Number.isFinite(browserOffset) || Math.abs(browserOffset) > 23 * 60 + 59) return null;
  return `${normalizedValue}:00${formatOffset(browserOffset)}`;
}

export function observedAtToLocalInput(
  value: string | null,
  offsetMinutes?: number | null,
): string {
  if (!value) return "";
  const observedAt = new Date(value);
  if (Number.isNaN(observedAt.getTime())) return "";
  const browserOffset = offsetMinutes ?? -observedAt.getTimezoneOffset();
  return formatLocalDateTime(observedAt, browserOffset);
}
