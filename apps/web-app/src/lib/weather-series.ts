export type WeatherRainObservation = {date: string; precipitation_mm: number | null};
const DAY_MS = 86_400_000;
function dateMs(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value ? parsed : null;
}
export function weatherPeriodError(start: string, end: string, latestAllowedDate: string): string | null {
  const a = dateMs(start), b = dateMs(end), latest = dateMs(latestAllowedDate);
  if (a == null || b == null || latest == null) return "Velg gyldige kalenderdatoer.";
  if (b < a) return "Sluttdato må være på eller etter startdato.";
  if (b > latest) return "Perioden kan ikke gå forbi dagens dato i UTC.";
  if (b - a > 366 * DAY_MS) return "Velg et intervall på høyst 367 døgn.";
  return null;
}
export function utcWeatherDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}
export function yearToDatePeriod(referenceDate: string) {
  if (dateMs(referenceDate) == null) throw new Error("Ugyldig referansedato");
  return {start: `${referenceDate.slice(0, 4)}-01-01`, end: referenceDate};
}
export function buildWeatherRainSeries(observations: WeatherRainObservation[], start: string, end: string) {
  const a = dateMs(start), b = dateMs(end);
  if (a == null || b == null || b < a || b - a > 366 * DAY_MS) throw new Error("Ugyldig værintervall");
  const byDate = new Map(observations.map(day => [day.date, day.precipitation_mm]));
  const days: {date: string; rainMm: number | null; cumulativeAvailableMm: number | null}[] = [];
  const months = new Map<string, {month: string; availableSumMm: number | null; coveredDays: number; selectedDays: number; calendarDays: number}>();
  let availableSum = 0, coveredDays = 0;
  for (let instant = a; instant <= b; instant += DAY_MS) {
    const date = new Date(instant).toISOString().slice(0, 10), month = date.slice(0, 7);
    const raw = byDate.get(date);
    const rainMm = typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
    if (rainMm != null) { availableSum += rainMm; coveredDays += 1; }
    days.push({date, rainMm, cumulativeAvailableMm: rainMm == null ? null : availableSum});
    const total = months.get(month) ?? {month, availableSumMm: null, coveredDays: 0, selectedDays: 0,
      calendarDays: new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate()};
    total.selectedDays += 1;
    if (rainMm != null) { total.availableSumMm = (total.availableSumMm ?? 0) + rainMm; total.coveredDays += 1; }
    months.set(month, total);
  }
  return {days, months: [...months.values()], availableSumMm: coveredDays ? availableSum : null,
    coveredDays, expectedDays: days.length, complete: coveredDays === days.length};
}
