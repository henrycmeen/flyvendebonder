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
