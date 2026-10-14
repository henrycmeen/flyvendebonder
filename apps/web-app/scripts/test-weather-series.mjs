import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({entryPoints: ["src/lib/weather-series.ts"], bundle: true, format: "esm", write: false});
const {buildWeatherRainSeries, weatherPeriodError, yearToDatePeriod, utcWeatherDate} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
// Partial months spanning a leap-year boundary: null/absent days are gaps, zero is covered.
const fixture = [
  {date: "2024-01-29", precipitation_mm: 100},
  {date: "2024-01-30", precipitation_mm: 2},
  {date: "2024-01-31", precipitation_mm: null},
  {date: "2024-02-01", precipitation_mm: 0},
  {date: "2024-02-03", precipitation_mm: 4},
  {date: "2024-02-04", precipitation_mm: 100},
];
const series = buildWeatherRainSeries(fixture, "2024-01-30", "2024-02-03");
assert.deepEqual(series.days.map(day => day.rainMm), [2, null, 0, null, 4]);
assert.deepEqual(series.days.map(day => day.cumulativeAvailableMm), [2, null, 2, null, 6]);
assert.equal(series.availableSumMm, 6);
assert.equal(series.coveredDays, 3);
assert.equal(series.expectedDays, 5);
assert.equal(series.complete, false);
assert.deepEqual(series.months, [
  {month: "2024-01", availableSumMm: 2, coveredDays: 1, selectedDays: 2, calendarDays: 31},
  {month: "2024-02", availableSumMm: 4, coveredDays: 2, selectedDays: 3, calendarDays: 29},
]);
assert.equal(buildWeatherRainSeries([], "2024-02-29", "2024-02-29").availableSumMm, null);
assert.equal(buildWeatherRainSeries([{date: "2024-02-29", precipitation_mm: 0}], "2024-02-29", "2024-02-29").complete, true);
assert.equal(weatherPeriodError("2024-01-01", "2025-01-01", "2025-01-01"), null);
assert.notEqual(weatherPeriodError("2024-01-01", "2025-01-02", "2025-01-02"), null);
assert.notEqual(weatherPeriodError("2024-02-30", "2024-03-01", "2024-03-01"), null);
assert.notEqual(weatherPeriodError("2024-02-01", "2024-02-03", "2024-02-02"), null);
assert.deepEqual(yearToDatePeriod("2024-12-31"), {start: "2024-01-01", end: "2024-12-31"});
assert.deepEqual(yearToDatePeriod("2025-01-01"), {start: "2025-01-01", end: "2025-01-01"});
assert.equal(weatherPeriodError("2024-01-01", "2024-12-31", "2024-12-31"), null);
// Oslo has reached the next day while the API still uses the previous UTC date.
const apiToday = utcWeatherDate(new Date("2026-10-06T00:30:00+02:00"));
assert.equal(apiToday, "2026-10-05");
assert.deepEqual(yearToDatePeriod(apiToday), {start: "2026-01-01", end: "2026-10-05"});
assert.notEqual(weatherPeriodError("2026-10-05", "2026-10-06", apiToday), null);
console.log("weather-series fixture passed: gap/zero, available accumulation, partial months, leap day and bounded capture dates");
