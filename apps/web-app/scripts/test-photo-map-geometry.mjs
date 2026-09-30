import assert from "node:assert/strict";
import path from "node:path";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: ["src/lib/photo-map-geometry.ts"],
  bundle: true, format: "esm", platform: "browser", write: false,
  alias: { "@": path.join(process.cwd(), "src") },
});
const { validMapPoint, photoAnalysisTarget, photoViewHeading } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const nadir = { lat: 59, lng: 9, heading_deg: 210, pitch_deg: -90, view_lat: 59, view_lng: 9 };
assert.equal(photoViewHeading(nadir), null, "nadir gimbal yaw must not be drawn as a horizontal drone heading");
for (const [view_lat, view_lng, heading] of [[59.001, 9, 0], [59, 9.001, 90], [58.999, 9, 180], [59, 8.999, 270]]) {
  const actual = photoViewHeading({ ...nadir, view_lat, view_lng, pitch_deg: -45 });
  assert.ok(Math.abs(actual - heading) < 0.01, `beam and arrow must agree at ${heading} degrees`);
}
assert.equal(photoViewHeading({ ...nadir, view_lat: 59.000001 }), null, "GPS rounding must not invent a direction for nadir");
for (const [lat, lng] of [[NaN, 9], [59, Infinity], [91, 9], [59, -181], [null, 9]]) {
  assert.equal(validMapPoint({ lat, lng }), null);
  const photo = { ...nadir, view_lat: lat, view_lng: lng };
  assert.equal(photoAnalysisTarget(photo), null);
  assert.equal(photoViewHeading(photo), null, "invalid targets must not create a fake heading ray");
}
assert.deepEqual(validMapPoint({ lat: 0, lng: 0 }), [0, 0], "zero coordinates are valid");
assert.deepEqual(photoAnalysisTarget({ ...nadir, analysis_zone: { center_point: { lat: NaN, lng: 9 } } }), [59, 9]);
assert.deepEqual(photoAnalysisTarget({ ...nadir, analysis_zone: { center_point: { lat: 60, lng: 10 } } }), [60, 10]);
assert.equal(photoViewHeading({ ...nadir, lat: NaN }), null);
console.log("photo map geometry tests passed");
