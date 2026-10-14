import assert from "node:assert/strict";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export {
        currentLocalDateTimeInput,
        observedAtInputToRfc3339,
        observedAtToLocalInput,
      } from "./src/lib/observed-at.ts";
    `,
    resolveDir: process.cwd(),
    sourcefile: "observed-at-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  treeShaking: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const {
  currentLocalDateTimeInput,
  observedAtInputToRfc3339,
  observedAtToLocalInput,
} = await import(moduleUrl);

assert.equal(
  currentLocalDateTimeInput(new Date("2026-07-16T08:15:00Z"), 120),
  "2026-07-16T10:15",
);
assert.equal(
  observedAtInputToRfc3339("2026-07-16T10:15", 120),
  "2026-07-16T10:15:00+02:00",
);
assert.equal(
  observedAtInputToRfc3339("2026-07-16T06:30", -240),
  "2026-07-16T06:30:00-04:00",
);
assert.equal(observedAtInputToRfc3339("ikke-et-tidspunkt", 120), null);
assert.equal(
  observedAtToLocalInput("2026-07-16T08:15:00Z", 120),
  "2026-07-16T10:15",
);
const originalOffsetInput = observedAtToLocalInput("2026-07-16T10:30:00Z", -240);
assert.equal(originalOffsetInput, "2026-07-16T06:30");
assert.equal(
  observedAtInputToRfc3339(originalOffsetInput, -240),
  "2026-07-16T06:30:00-04:00",
);
assert.equal(observedAtToLocalInput(null, null), "");

console.log("observed-at tests passed");

// Comparison must use observation time and recorded timezone, not created/updated task time.
const comparisonBundle = await build({ entryPoints: ["src/lib/comparison-observations.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const { observationsBetween, comparisonObservationTime, isObservationDate } = await import(`data:text/javascript;base64,${Buffer.from(comparisonBundle.outputFiles[0].text).toString("base64")}`);
const observation = (id, extra = {}) => ({id, property_id: 7, observed_at: "2026-08-01T22:30:00Z", observed_at_original_offset: "+02:00", created_at:"2026-08-02T00:00:00Z", updated_at:"2026-09-01T00:00:00Z", ...extra});
const dated = observation(1);
assert.equal(comparisonObservationTime(dated).date, "2026-08-02");
assert.equal(comparisonObservationTime(observation(2,{observed_at_original_offset:"-04:00"})).date,"2026-08-01");
const selection = observationsBetween([dated,observation(2,{property_id:8}),observation(3,{observed_at:null}),observation(4,{observed_at:"invalid"}),observation(5,{observed_at:"2026-03-30T20:00:00Z"}),observation(6,{observed_at:"2026-03-30T23:00:00Z"})],7,"2026-08-02","2026-03-31");
assert.deepEqual(selection.rows.map(row=>row.task.id),[6,1]);
assert.equal(selection.undatedCount,2);
assert.equal(comparisonObservationTime(observation(7,{observed_at_original_offset:"+99:00"})),null);
assert.equal(comparisonObservationTime(observation(7,{observed_at:"2026-08-01T22:30:00"})),null);
assert.match(comparisonObservationTime(observation(7,{observed_at_original_offset:null})).offset,/UTC.*ukjent/);
assert.equal(isObservationDate("2026-02-30"),false);
assert.equal(isObservationDate("2026-08-02"),true);
assert.equal(observationsBetween([observation(1,{observed_at:null})],7,"2026-03-31","2026-08-02").rows.length,0);
console.log("comparison observation date, scope, inclusive boundaries and unknown time tests passed");
