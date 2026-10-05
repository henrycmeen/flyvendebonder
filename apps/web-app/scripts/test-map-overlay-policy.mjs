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

// Comparison must never synchronize across property scope, disjoint extents or unknown bounds.
const comparisonBundle = await build({ entryPoints: ["src/lib/library-comparison.ts"], bundle: true, format: "esm", platform: "browser", write: false });
const { overlappingBounds, photoComparisonImages, orthophotoComparisonImages } = await import(`data:text/javascript;base64,${Buffer.from(comparisonBundle.outputFiles[0].text).toString("base64")}`);
const march = {id:"march",scope:"4003-70/17/0",date:"2026-03-31",bounds:{south:59.172157286621996,west:9.664306674615593,north:59.17549895458715,east:9.676921499587127}};
const august = {id:"august",scope:march.scope,date:"2026-08-02",bounds:{south:59.16761524724223,west:9.65982260728805,north:59.17664053427298,east:9.677903331908693}};
assert.deepEqual(overlappingBounds(march,august),march.bounds);
assert.equal(overlappingBounds(march,{...august,scope:"other-property"}),null);
assert.equal(overlappingBounds(march,{...august,bounds:undefined}),null);
assert.equal(overlappingBounds(march,{...august,bounds:{south:60,west:10,north:61,east:11}}),null);
assert.equal(overlappingBounds(march,{...august,bounds:{...august.bounds,south:NaN}}),null);
const photoCandidates = photoComparisonImages([{id:"invalid-calendar",property_id:1,captured_date:"2026-02-30",title:"Invalid",image_url:"photo.jpg"},{id:"unknown-date",property_id:1,captured_date:"",title:"Unknown",image_url:"photo.jpg"},{id:"unscoped",property_id:null,captured_date:"2026-03-31",title:"Unscoped"},{id:"valid",property_id:1,captured_date:"2026-03-31",title:"Original filename",image_url:null,thumbnail_url:"thumb.jpg"}]);
assert.equal(photoCandidates.length,1);
assert.equal(photoCandidates[0].imageUrl,"thumb.jpg");
assert.equal(photoCandidates[0].bounds,undefined);
assert.match(photoCandidates[0].source,/Original filename/);
assert.equal(orthophotoComparisonImages([{...march,label:"Jorde 4",propertyReference:march.scope,capturedDate:march.date,imageUrl:"preview.webp"}])[0].imageUrl,"preview.webp");
console.log("library comparison scope, coverage and source tests passed");
