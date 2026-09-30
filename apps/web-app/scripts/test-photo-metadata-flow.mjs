import assert from "node:assert/strict";

import { build } from "esbuild";

const bundle = await build({
  stdin: {
    contents: `
      export { editablePhotoTags, isSystemPhotoTag, parseManualViewTarget } from "./src/lib/formatters.ts";
    `,
    resolveDir: new URL("..", import.meta.url).pathname,
    sourcefile: "photo-metadata-flow-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  treeShaking: false,
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { editablePhotoTags, isSystemPhotoTag, parseManualViewTarget } = await import(moduleUrl);

assert.equal(isSystemPhotoTag(" qc:test "), true);
assert.equal(isSystemPhotoTag("META:test"), true);
assert.equal(isSystemPhotoTag("metadata"), false);

assert.deepEqual(
  editablePhotoTags(["dronefoto", " meta:heading_source=imu ", "QC:needs_manual_qc", " Meen gård ", "dronefoto"]),
  ["dronefoto", "Meen gård"],
  "editing an imported photo must send user tags without reserved metadata or QC tags",
);

assert.deepEqual(
  parseManualViewTarget([
    "META:MANUAL_VIEW_LAT=59.168146",
    "meta:manual_view_lng=9.662754",
  ]),
  { lat: 59.168146, lng: 9.662754 },
  "manual view tags must be parsed independently of key casing",
);
assert.equal(
  parseManualViewTarget(["meta:manual_view_lat=59.168146"]),
  null,
  "a partial manual view override must not become a target",
);

console.log("photo metadata flow tests passed");
