import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { build } from "esbuild";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");

const bundle = await build({
  stdin: {
    contents: `
      export { parseManualViewTarget } from "./src/lib/formatters.ts";
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
const { parseManualViewTarget } = await import(moduleUrl);

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

assert.match(
  app,
  /apiGet<PhotosResponse>\("\/api\/v1\/photos",[\s\S]*?mode: "cumulative"[\s\S]*?cache: false[\s\S]*?dedupe: false/,
  "metadata save must refresh the canonical photo after PATCH",
);
assert.match(app, /metadataSaveTokensRef\.current\.get\(photoId\) !== saveToken/, "stale metadata responses must be ignored");
assert.match(app, /selectedPhotoIdRef\.current === photoId/, "metadata drafts must stay bound to the saved photo");
assert.match(app, /initialPhotoRef\.current && \(!mapPhotoPaginationComplete \|\| isMapPhotosLoading\)/, "map deep links must survive the empty loading state");
assert.match(app, /if \(albumLoadedDate !== latestTimelineDate\) return;/, "album deep links must wait for the first page state");
assert.match(app, /void loadAlbumPage\(\{ reset: false \}\)/, "album deep links must request later pages while pending");
assert.match(app, /const pendingPhotoParam = syncSelectionToUrl \? initialPhotoRef\.current : null/, "pending deep links must remain in the URL");

console.log("photo metadata flow tests passed");
