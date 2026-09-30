import assert from "node:assert/strict";
import { build } from "esbuild";

const bundle = await build({ entryPoints: ["src/lib/capture-sequence.ts"], bundle: true, format: "esm", write: false });
const { buildCaptureSequence, formatCaptureTimestamp } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const photo = (id, captured_at) => Object.freeze({ id, captured_at, title: id });
const input = Object.freeze([
  photo("last", "2025-03-01T12:30:00+02:00"),
  photo("tie-z", "2025-03-01T10:00:00Z"),
  photo("old", "2024-12-31T23:00:00Z"),
  photo("tie-a", "2025-03-01T12:00:00+02:00"),
  photo("naive", "2025-02-28T23:59:59"),
  photo("invalid", "2025-02-30T08:00:00Z"),
  photo("missing", null),
  photo("last", "2025-03-01T12:30:00+02:00"),
  photo("invalid", "2025-02-30T08:00:00Z"),
]);
const before = JSON.stringify(input);
const sequence = buildCaptureSequence(input);
assert.deepEqual(sequence.photos.map(({ id }) => id), ["old", "naive", "tie-a", "tie-z", "last"]);
assert.equal(sequence.excludedCount, 2, "duplicate page rows do not inflate excluded count");
assert.equal(sequence.photos.at(-1), input[0], "retain original first photo object");
assert.equal(JSON.stringify(input), before, "sorting and deduplication must not mutate input");
assert.deepEqual(buildCaptureSequence([]), { photos: [], excludedCount: 0 });
assert.deepEqual(buildCaptureSequence([photo("repeat", "bad"), photo("repeat", "2024-01-01T00:00:00Z")]), { photos: [], excludedCount: 1 }, "first page record owns a repeated ID");

const invalid = ["", "unknown", "2025-01-01", "2025-02-29T12:00:00", "2024-02-30T12:00:00Z", "2025-04-31T12:00:00+02:00", "2025-13-01T00:00:00Z", "2025-01-00T00:00:00Z", "2025-01-01T24:00:00Z", "2025-01-01T12:60:00Z", "2025-01-01T12:00:60Z", "2025-01-01T12:00:00+24:00", "2025-01-01T12:00:00+14:01", "2025-01-01T12:00:00-14:01", "2025-01-01T12:00:00+01:60", "2025-01-01T12:00:00junk"];
for (const [index, value] of invalid.entries()) {
  assert.equal(buildCaptureSequence([photo(`invalid-${index}`, value)]).excludedCount, 1, value);
  assert.equal(formatCaptureTimestamp(value), "Ukjent opptakstid", value);
}
assert.equal(buildCaptureSequence([photo("leap", "2024-02-29T12:00:00")]).excludedCount, 0);
const fractional = buildCaptureSequence([photo("a", "2025-01-01T00:00:00.12Z"), photo("z", "2025-01-01T00:00:00.11Z")]);
assert.deepEqual(fractional.photos.map(({ id }) => id), ["z", "a"]);
assert.deepEqual(buildCaptureSequence([photo("local-next-day", "2025-01-02T00:15:00+05:30"), photo("utc", "2025-01-01T19:00:00Z")]).photos.map(({ id }) => id), ["local-next-day", "utc"]);

assert.equal(formatCaptureTimestamp("2025-03-30T02:30:00"), "30. mars 2025 kl. 02:30:00 (tidssone ukjent)", "naive camera time survives Oslo DST gap");
assert.equal(formatCaptureTimestamp("2025-10-26 02:30"), "26. oktober 2025 kl. 02:30:00 (tidssone ukjent)");
assert.equal(formatCaptureTimestamp("2025-01-02T00:15:00+05:30"), "2. januar 2025 kl. 00:15:00 (UTC+05:30)", "display recorded offset without moving calendar day");
assert.equal(formatCaptureTimestamp("2025-01-02T00:15:00+0530"), "2. januar 2025 kl. 00:15:00 (UTC+05:30)");
assert.equal(formatCaptureTimestamp("2025-01-01T23:45:00-08:00"), "1. januar 2025 kl. 23:45:00 (UTC-08:00)");
assert.equal(formatCaptureTimestamp("2025-01-01T12:00:00.125Z"), "1. januar 2025 kl. 12:00:00.125 (UTC+00:00)");

assert.equal(buildCaptureSequence([photo("max-offset", "2025-01-01T12:00:00+14:00")]).excludedCount, 0);
assert.equal(formatCaptureTimestamp("2025-01-01T12:00:00-00:00"), "1. januar 2025 kl. 12:00:00 (tidssone ukjent)");
assert.equal(formatCaptureTimestamp("2025-01-01T12:00:00-0000"), "1. januar 2025 kl. 12:00:00 (tidssone ukjent)");

console.log("capture-sequence tests passed: calendar validation, chronological ordering, ID ties, pagination deduplication, no mutation, naive clocks and recorded offsets");
