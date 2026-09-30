import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({ entryPoints: ["src/lib/capture-timeline.ts"], bundle: true, format: "esm", write: false });
const { captureTimelineState, formatCaptureDate, readCaptureScope, writeCaptureScope } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const input = [
  { date: "2025-03-01", count: 3, index: 0 },
  { date: "2024-12-31", count: 8, index: 4 },
  { date: "2025-01-04", count: 2, index: 9 },
  { date: "2025-02-30", count: 99, index: 2 },
  { date: "unknown", count: 99, index: 3 },
];
const middle = captureTimelineState(input, "2025-01-04");
assert.deepEqual(middle.dates.map((date) => date.index), [4, 9, 0]);
assert.equal(middle.previous.index, 4);
assert.equal(middle.next.index, 0);
assert.equal(middle.photoCount, 13);
assert.equal(input[0].date, "2025-03-01");
assert.equal(middle.range, `${formatCaptureDate("2024-12-31", true)} – ${formatCaptureDate("2025-03-01", true)}`);
assert.equal(captureTimelineState(input, "2024-12-31").previous, null);
assert.equal(captureTimelineState(input, "2025-03-01").next, null);
const stale = captureTimelineState(input, "2020-01-01");
assert.equal(stale.selected, null);
assert.equal(stale.previous, null);
assert.equal(stale.next, null);
const empty = captureTimelineState([]);
assert.equal(empty.range, "Ingen opptaksdatoer");
assert.equal(empty.photoCount, 0);
const single = captureTimelineState([{date: "2024-02-29", count: 1, index: 7}], "2024-02-29");
assert.equal(single.range, formatCaptureDate("2024-02-29", true));
assert.equal(single.previous, null);
assert.equal(single.next, null);
console.log("capture-timeline tests passed: chronological order, original indices, boundaries, empty/stale selection and invalid calendar dates");

assert.equal(readCaptureScope(new URLSearchParams("date=2025-03-01")), "all");
assert.equal(readCaptureScope(new URLSearchParams("date=2025-03-01&scope=day")), "selected");
assert.equal(readCaptureScope(new URLSearchParams("date=2025-02-30&scope=day")), "all");
assert.equal(readCaptureScope(new URLSearchParams("scope=day")), "all");
const dayUrl = new URLSearchParams("date=2025-03-01&photo=explicit-photo&other=keep");
writeCaptureScope(dayUrl, "selected", true);
assert.equal(readCaptureScope(dayUrl), "selected");
assert.equal(dayUrl.get("photo"), "explicit-photo");
assert.equal(dayUrl.get("other"), "keep");
writeCaptureScope(dayUrl, "all", true);
assert.equal(dayUrl.has("scope"), false);
writeCaptureScope(dayUrl, "selected", false);
assert.equal(dayUrl.has("scope"), false);
console.log("capture scope URL tests passed: legacy cursor, explicit day, invalid date, round trip and unrelated params");
