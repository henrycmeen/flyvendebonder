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
const { overlappingBounds, photoComparisonImages, orthophotoComparisonImages, rankPhotoComparisonCandidates } = await import(`data:text/javascript;base64,${Buffer.from(comparisonBundle.outputFiles[0].text).toString("base64")}`);
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

// Matching a cadastral reference must retain the real numeric property identity.
const scopedOrtho = orthophotoComparisonImages([{...march,label:"Jorde 4",propertyReference:"4003-70/17/0",capturedDate:march.date,imageUrl:"preview.webp"}], [{id:71,komm:"4003",gnr:70,bnr:17,fnr:0}]);
assert.equal(scopedOrtho[0].propertyId,71);
assert.equal(orthophotoComparisonImages([{...march,label:"Unknown",propertyReference:"4003-99/99/0",capturedDate:march.date,imageUrl:"preview.webp"}], [{id:71,komm:"4003",gnr:70,bnr:17,fnr:0}])[0].propertyId,null);
assert.equal(photoCandidates[0].propertyId,1);

// Same-date filename ordering must not choose a distant photo over a nearby one.
const anchor = {id:"anchor",propertyId:1,scope:"Eiendom 1",date:"2026-03-31",imageUrl:"anchor.jpg",lat:59,lng:9};
const otherDate = { ...anchor, date:"2026-08-02" };
const nearest = {...otherDate,id:"z-nearest",lat:59.00005};
const farther = {...otherDate,id:"a-farther",lat:59.0002};
const tooFar = {...otherDate,id:"far",lat:59.002};
const unknown = {...otherDate,id:"unknown",lat:null,lng:null};
const ranked = rankPhotoComparisonCandidates(anchor,[tooFar,farther,nearest,unknown],"2026-08-02");
assert.equal(ranked.status,"matched");
assert.deepEqual(ranked.candidates.map(item=>item.image.id),["z-nearest","a-farther"]);
assert.ok(ranked.candidates[0].distanceM > 5 && ranked.candidates[0].distanceM < 6);
assert.equal(ranked.candidates[0].directionStatus,"unknown");
assert.equal(rankPhotoComparisonCandidates(anchor,[tooFar]).status,"no-nearby-candidate");
assert.equal(rankPhotoComparisonCandidates(anchor,[unknown]).status,"unknown-location");
assert.equal(rankPhotoComparisonCandidates({...anchor,lat:NaN},[nearest]).status,"unknown-location");
assert.equal(rankPhotoComparisonCandidates(anchor,[{...nearest,propertyId:2}]).candidates.length,0);
assert.equal(rankPhotoComparisonCandidates(anchor,[{...nearest,date:anchor.date}]).candidates.length,0);
assert.equal(rankPhotoComparisonCandidates(anchor,[nearest],"2026-09-01").candidates.length,0);
const tied = [{...nearest,id:"b"},{...nearest,id:"a"}];
assert.deepEqual(rankPhotoComparisonCandidates(anchor,tied).candidates.map(item=>item.image.id),["a","b"]);
assert.deepEqual(rankPhotoComparisonCandidates(anchor,[...tied].reverse()),rankPhotoComparisonCandidates(anchor,tied));
// Ground-target matches can have distant camera GPS; camera and target coordinates never mix.
const targetAnchor = {...anchor,viewLat:59.005,viewLng:9,viewMode:"estimated",viewConfidence:0.8};
const targetMatch = {...nearest,lat:60,viewLat:59.00505,viewLng:9,viewMode:"manual",viewConfidence:1};
assert.equal(rankPhotoComparisonCandidates(targetAnchor,[targetMatch]).candidates[0].positionType,"view-target");
assert.equal(rankPhotoComparisonCandidates(targetAnchor,[nearest]).status,"unknown-location");
assert.equal(rankPhotoComparisonCandidates({...anchor,pitchDeg:-45,headingDeg:0},[{...nearest,pitchDeg:-45,headingDeg:180}]).candidates.length,0);
assert.equal(rankPhotoComparisonCandidates({...anchor,pitchDeg:-90,headingDeg:0},[{...nearest,pitchDeg:-90,headingDeg:180}]).candidates[0].directionStatus,"compatible");
assert.equal(rankPhotoComparisonCandidates({...anchor,pitchDeg:-90},[{...nearest,pitchDeg:-45}]).candidates.length,0);
assert.equal(rankPhotoComparisonCandidates({...anchor,pitchDeg:-45,headingDeg:350},[{...nearest,pitchDeg:-45,headingDeg:10}]).candidates[0].headingDifferenceDeg,20);
assert.equal(rankPhotoComparisonCandidates(anchor,[{...nearest,locationUncertaintyM:100}]).candidates.length,0);
const metadata = photoComparisonImages([{id:"metadata",property_id:1,captured_date:"2026-03-31",title:"Metadata",image_url:"original.jpg",thumbnail_url:"thumb.jpg",lat:59,lng:9,view_lat:59.005,view_lng:9.005,heading_deg:45,pitch_deg:-45,altitude_m:80,location_uncertainty_m:3,heading_source:"gimbal",pitch_source:"gimbal",view_mode:"oblique",view_confidence:0.8}])[0];
assert.equal(metadata.thumbnailUrl,"thumb.jpg");
assert.equal(metadata.lat,59);
assert.equal(metadata.lng,9);
assert.equal(metadata.viewLat,59.005);
assert.equal(metadata.viewLng,9.005);
assert.equal(metadata.headingDeg,45);
assert.equal(metadata.pitchDeg,-45);
assert.equal(metadata.altitudeM,80);
assert.equal(metadata.locationUncertaintyM,3);
assert.equal(metadata.headingSource,"gimbal");
assert.equal(metadata.pitchSource,"gimbal");
assert.equal(metadata.viewMode,"oblique");
assert.equal(metadata.viewConfidence,0.8);
console.log("library comparison spatial candidate tests passed");

// A point-mode view is the camera proxy even if its coords happen to be nearby.
const pointProxy = {...targetMatch,viewMode:"point",viewConfidence:0.5};
assert.equal(rankPhotoComparisonCandidates(targetAnchor,[pointProxy]).status,"unknown-location");
assert.equal(rankPhotoComparisonCandidates(targetAnchor,[{...pointProxy,viewMode:null}]).status,"unknown-location");
assert.equal(rankPhotoComparisonCandidates(targetAnchor,[{...pointProxy,viewMode:"unknown-future-mode"}]).status,"unknown-location");
// A point-mode anchor uses its real camera GPS; its view proxy cannot drive selection.
assert.equal(rankPhotoComparisonCandidates({...targetAnchor,viewMode:"point"},[nearest]).candidates[0].positionType,"camera");
assert.equal(rankPhotoComparisonCandidates({...targetAnchor,viewMode:"point"},[targetMatch]).status,"no-nearby-candidate");
const targetRank = rankPhotoComparisonCandidates(targetAnchor,[targetMatch]).candidates[0];
assert.equal(targetRank.targetConfidence,0.8);
assert.equal(targetRank.targetConfidenceStatus,"reported");
const lowConfidenceRank = rankPhotoComparisonCandidates(targetAnchor,[{...targetMatch,viewConfidence:0.6}]).candidates[0];
assert.equal(lowConfidenceRank.targetConfidence,0.6);
assert.equal(lowConfidenceRank.targetConfidenceStatus,"low");
for (const viewConfidence of [null,undefined,NaN,-0.1,1.1]) {
  const candidate = rankPhotoComparisonCandidates(targetAnchor,[{...targetMatch,viewConfidence}]).candidates[0];
  assert.equal(candidate.targetConfidence,null);
  assert.equal(candidate.targetConfidenceStatus,"unknown");
}
assert.equal(ranked.candidates[0].targetConfidenceStatus,"unknown");
assert.equal(ranked.candidates[0].targetConfidence,null);
console.log("library comparison target mode and confidence tests passed");
