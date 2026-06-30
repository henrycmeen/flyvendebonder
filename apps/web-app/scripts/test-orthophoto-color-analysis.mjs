import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

const srcDir = path.join(process.cwd(), "src");

const bundle = await build({
  stdin: {
    contents: `
      export {
        analyzeOrthophotoColorPixels,
        ORTHOPHOTO_SAMPLE_SIZE_PX,
      } from "./src/lib/orthophoto-color-analysis.ts";
      export {
        orthophotoBackendSampleToOutcome,
        projectLayerPointToImagePixel,
      } from "./src/lib/browser-orthophoto-sampler.ts";
    `,
    resolveDir: process.cwd(),
    sourcefile: "orthophoto-color-analysis-test-entry.ts",
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "browser",
  write: false,
  treeShaking: false,
  alias: {
    "@": srcDir,
  },
});

const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const {
  analyzeOrthophotoColorPixels,
  ORTHOPHOTO_SAMPLE_SIZE_PX,
  orthophotoBackendSampleToOutcome,
  projectLayerPointToImagePixel,
} = await import(moduleUrl);

function rgbaFixture(pixels) {
  return new Uint8ClampedArray(pixels.flat());
}

const analysis = analyzeOrthophotoColorPixels(
  rgbaFixture([
    [20, 90, 30, 255],
    [30, 120, 45, 255],
    [180, 185, 170, 255],
    [0, 0, 0, 0],
  ]),
  2,
  2,
  { requestedSizePx: ORTHOPHOTO_SAMPLE_SIZE_PX, clipped: true },
);

assert.equal(analysis.validPixels, 3);
assert.equal(analysis.sampledPixels, 4);
assert.equal(analysis.clipped, true);
assert.deepEqual(analysis.meanRgb, { r: 76.7, g: 131.7, b: 81.7 });
assert.deepEqual(analysis.medianRgb, { r: 30, g: 120, b: 45 });
assert.equal(Number.isFinite(analysis.indices.exg), true);
assert.equal(Number.isFinite(analysis.indices.vari), true);
assert.equal(Number.isFinite(analysis.indices.ngrdi), true);
assert.equal(Number.isFinite(analysis.indices.gli), true);
assert.equal(Number.isFinite(analysis.indices.ndyi), true);
assert.equal(analysis.qualityFlags.includes("edge_clipped"), true);
assert.equal(analysis.qualityFlags.includes("low_valid_pixels"), true);
assert.equal(analysis.qualityFlags.includes("transparent_or_nodata"), true);

const projected = projectLayerPointToImagePixel({
  point: { x: 350, y: 500 },
  northWest: { x: 100, y: 100 },
  southEast: { x: 600, y: 900 },
  imageWidth: 1000,
  imageHeight: 1600,
});

assert.deepEqual(projected, { x: 500, y: 800, ratioX: 0.5, ratioY: 0.5 });

const zeroDenominator = analyzeOrthophotoColorPixels(
  rgbaFixture([
    [0, 0, 0, 255],
  ]),
  1,
  1,
);
assert.equal(zeroDenominator.indices.vari, 0);
assert.equal(zeroDenominator.indices.ngrdi, 0);

const backendOutcome = orthophotoBackendSampleToOutcome(
  {
    id: "jorde-9-orthophoto",
    label: "Jorde 9 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: "/dev-overlays/jorde-9-orthophoto.webp",
    capturedDate: "2026-04-01",
    bounds: { south: 59.13, west: 9.67, north: 59.14, east: 9.68 },
    tileLayer: {
      urlTemplate: "/tiles/{z}/{x}/{y}.webp",
      minZoom: 14,
      maxZoom: 19,
      maxNativeZoom: 19,
      tileSize: 256,
      sourceKind: "preview",
      sourceWidthPx: 2400,
      sourceHeightPx: 4426,
      canonicalWidthPx: 14324,
      canonicalHeightPx: 26416,
      tileCount: 300,
      qualityScale: 5.97,
    },
  },
  {
    overlay: {
      id: "jorde-9-orthophoto",
      label: "Jorde 9 ortofoto",
      captured_date: "2026-04-01",
      property_reference: "4003-70/17/0",
    },
    source: {
      kind: "preview",
      path_basename: "jorde-9-orthophoto.webp",
      width_px: 2400,
      height_px: 4426,
      canonical_width_px: 14324,
      canonical_height_px: 26416,
      gsd_m_per_px: { x: 0.16, y: 0.16 },
    },
    point: { lat: 59.135, lng: 9.675 },
    image_pixel: { x: 500, y: 800, ratio_x: 0.5, ratio_y: 0.5 },
    analysis: {
      requested_size_px: 21,
      sampled_width_px: 21,
      sampled_height_px: 21,
      requested_pixels: 441,
      sampled_pixels: 441,
      valid_pixels: 441,
      clipped: false,
      mean_rgb: { r: 40, g: 120, b: 50 },
      median_rgb: { r: 40, g: 120, b: 50 },
      brightness: 0.36,
      light_assessment: "Balansert lys",
      indices: { exg: 0.58, vari: 0.36, ngrdi: 0.5, gli: 0.31, ndyi: 0.41 },
      quality_flags: [],
    },
  },
);
assert.equal(backendOutcome.status, "analysis");
assert.equal(backendOutcome.source.kind, "backend_orthophoto");
assert.equal(backendOutcome.source.sourceKind, "preview");
assert.deepEqual(backendOutcome.source.gsdMPerPx, { x: 0.16, y: 0.16 });
assert.deepEqual(backendOutcome.imagePixel, { x: 500, y: 800, ratioX: 0.5, ratioY: 0.5 });
assert.equal(backendOutcome.analysis.requestedSizePx, 21);

console.log(`orthophoto color analysis tests passed from ${pathToFileURL(process.cwd()).href}`);
