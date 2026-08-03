import assert from "node:assert/strict";
import path from "node:path";

import { build } from "esbuild";

const srcDir = path.join(process.cwd(), "src");
const bundle = await build({
  stdin: {
    contents: `export { resolveMapControlVisibility, shouldShowMapHoverPreview, shouldShowOperatingAreaInspector } from "./src/lib/map-overlay-policy.ts";`,
    resolveDir: process.cwd(),
    sourcefile: "map-overlay-policy-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  alias: { "@": srcDir },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const { resolveMapControlVisibility, shouldShowMapHoverPreview, shouldShowOperatingAreaInspector } = await import(
  moduleUrl
);

const visibleState = {
  isMapView: true,
  hasPreviewPhoto: true,
  hasPreviewImage: true,
  isPhotoViewerOpen: false,
  isTimelineFilterExpanded: false,
  isLayerPanelExpanded: false,
  isOperatingAreaToolActive: false,
  isColorAnalysisActive: false,
  hasPhotoLoadError: false,
};

assert.equal(shouldShowMapHoverPreview(visibleState), true);

for (const blocker of [
  "isPhotoViewerOpen",
  "isTimelineFilterExpanded",
  "isLayerPanelExpanded",
  "isOperatingAreaToolActive",
  "isColorAnalysisActive",
  "hasPhotoLoadError",
]) {
  assert.equal(
    shouldShowMapHoverPreview({ ...visibleState, [blocker]: true }),
    false,
    `${blocker} must suppress the secondary photo preview`,
  );
}

assert.equal(shouldShowMapHoverPreview({ ...visibleState, isMapView: false }), false);
assert.equal(shouldShowMapHoverPreview({ ...visibleState, hasPreviewPhoto: false }), false);
assert.equal(shouldShowMapHoverPreview({ ...visibleState, hasPreviewImage: false }), false);
assert.equal(shouldShowOperatingAreaInspector({ isToolActive: true, isLayerPanelExpanded: false }), true);
assert.equal(
  shouldShowOperatingAreaInspector({ isToolActive: true, isLayerPanelExpanded: true }),
  false,
  "the layer panel and operating-area inspector must not compete for the same stack",
);
assert.equal(shouldShowOperatingAreaInspector({ isToolActive: false, isLayerPanelExpanded: false }), false);

assert.deepEqual(
  resolveMapControlVisibility({
    hasPhotoLoadError: true,
    isOperatingAreaToolActive: true,
    isLayerPanelExpanded: false,
  }),
  {
    showPhotoLoadAlert: true,
    showLayerPanel: false,
    showOperatingAreaInspector: true,
  },
  "the photo-load alert and operating-area inspector must share the control stack without hiding each other",
);

assert.deepEqual(
  resolveMapControlVisibility({
    hasPhotoLoadError: false,
    isOperatingAreaToolActive: true,
    isLayerPanelExpanded: true,
  }),
  {
    showPhotoLoadAlert: false,
    showLayerPanel: true,
    showOperatingAreaInspector: false,
  },
  "an expanded layer panel must keep exclusive use of the control stack",
);

console.log("map overlay policy tests passed");
