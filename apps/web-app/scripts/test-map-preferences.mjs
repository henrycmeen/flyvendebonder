import assert from "node:assert/strict";
import { build } from "esbuild";
const bundle = await build({
  entryPoints: ["src/lib/map-preferences.ts"], bundle: true,
  format: "esm", platform: "browser", write: false,
});

const {
  normalizeBaseMapStyle,
  normalizeMapTonePreferences,
  readStoredMapPreference,
  setMapTonePreference,
  writeStoredMapPreference,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const values = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  },
};

assert.equal(normalizeBaseMapStyle("none"), "none");
assert.equal(normalizeBaseMapStyle("toString"), null);
assert.deepEqual(normalizeMapTonePreferences(true, true), { mapGrayscale: false, mapVintage: true });
assert.deepEqual(setMapTonePreference({ mapGrayscale: false, mapVintage: true }, "mapGrayscale", true), {
  mapGrayscale: true,
  mapVintage: false,
});
assert.deepEqual(setMapTonePreference({ mapGrayscale: true, mapVintage: false }, "mapVintage", true), {
  mapGrayscale: false,
  mapVintage: true,
});

writeStoredMapPreference("fb.map.baseStyle", "none");
assert.equal(readStoredMapPreference("fb.map.baseStyle"), "none");

globalThis.window.localStorage = {
  getItem() {
    throw new Error("storage blocked");
  },
  setItem() {
    throw new Error("storage blocked");
  },
};
assert.equal(readStoredMapPreference("fb.map.baseStyle"), null);
assert.doesNotThrow(() => writeStoredMapPreference("fb.map.baseStyle", "osm"));

console.log("map preference tests passed");
