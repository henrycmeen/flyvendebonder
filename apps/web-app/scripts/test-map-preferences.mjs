import assert from "node:assert/strict";

const {
  normalizeBaseMapStyle,
  normalizeMapTonePreferences,
  readStoredMapPreference,
  setMapTonePreference,
  writeStoredMapPreference,
} = await import("../src/lib/map-preferences.ts");

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
