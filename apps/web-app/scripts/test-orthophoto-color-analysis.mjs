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

console.log(`orthophoto color analysis tests passed from ${pathToFileURL(process.cwd()).href}`);
