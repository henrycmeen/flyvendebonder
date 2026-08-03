import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const [css, app, panel, inspector, mapCanvas, colorAnalysisPopup] = await Promise.all([
  readFile(new URL("src/index.css", root), "utf8"),
  readFile(new URL("src/App.tsx", root), "utf8"),
  readFile(new URL("src/components/map-layer-panel.tsx", root), "utf8"),
  readFile(new URL("src/components/operating-area-inspector.tsx", root), "utf8"),
  readFile(new URL("src/components/map-canvas.tsx", root), "utf8"),
  readFile(new URL("src/components/orthophoto-color-analysis-popup.tsx", root), "utf8"),
]);

function parseHex(value) {
  const hex = value.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function parseRgba(value) {
  const values = value.match(/[\d.]+/g)?.map(Number) ?? [];
  assert.equal(values.length, 4, `Expected rgba color, got ${value}`);
  return values;
}

function composite([red, green, blue, alpha], background) {
  return [red, green, blue].map((channel, index) => channel * alpha + background[index] * (1 - alpha));
}

function luminance(rgb) {
  const channels = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(first, second) {
  const high = Math.max(luminance(first), luminance(second));
  const low = Math.min(luminance(first), luminance(second));
  return (high + 0.05) / (low + 0.05);
}

const satelliteBlock = css.match(/\.map-ui-satellite\s*\{([^}]+)\}/)?.[1] ?? "";
const surface = parseRgba(satelliteBlock.match(/--fb-map-control-surface:\s*([^;]+);/)?.[1] ?? "");
const ringDark = parseRgba(satelliteBlock.match(/--fb-map-control-ring-dark:\s*([^;]+);/)?.[1] ?? "");
const primary = parseHex(satelliteBlock.match(/--fb-map-control-primary:\s*(#[0-9a-f]{6});/i)?.[1] ?? "");
const secondary = parseHex(satelliteBlock.match(/--fb-map-control-secondary:\s*(#[0-9a-f]{6});/i)?.[1] ?? "");
const optionSurface = parseRgba(satelliteBlock.match(/--fb-map-overlay-option-surface:\s*([^;]+);/)?.[1] ?? "");
const selectedOptionSurface = parseRgba(satelliteBlock.match(/--fb-map-overlay-option-selected-surface:\s*([^;]+);/)?.[1] ?? "");
const successSurface = parseRgba(satelliteBlock.match(/--fb-map-overlay-success-surface:\s*([^;]+);/)?.[1] ?? "");

for (const background of [[0, 0, 0], [255, 255, 255]]) {
  const effectiveSurface = composite(surface, background);
  const effectiveOptionSurface = composite(optionSurface, effectiveSurface);
  const effectiveSelectedOptionSurface = composite(selectedOptionSurface, effectiveSurface);
  const effectiveSuccessSurface = composite(successSurface, effectiveSurface);
  assert.ok(contrast(primary, effectiveSurface) >= 4.5, "Primary satellite text must meet WCAG AA");
  assert.ok(contrast(secondary, effectiveSurface) >= 4.5, "Secondary satellite text must meet WCAG AA");
  assert.ok(contrast(primary, effectiveOptionSurface) >= 4.5, "Candidate-row text must meet WCAG AA on satellite imagery");
  assert.ok(contrast(secondary, effectiveOptionSurface) >= 4.5, "Candidate-row metadata must meet WCAG AA on satellite imagery");
  assert.ok(contrast(primary, effectiveSelectedOptionSurface) >= 4.5, "Selected candidate text must meet WCAG AA on satellite imagery");
  assert.ok(contrast(secondary, effectiveSelectedOptionSurface) >= 4.5, "Selected candidate metadata must meet WCAG AA on satellite imagery");
  assert.ok(contrast(primary, effectiveSuccessSurface) >= 4.5, "Success-card text must meet WCAG AA on satellite imagery");
  assert.ok(contrast(secondary, effectiveSuccessSurface) >= 4.5, "Success-card metadata must meet WCAG AA on satellite imagery");
  assert.ok(
    Math.max(contrast(primary, background), contrast(composite(ringDark, background), background)) >= 3,
    "At least one hover-ring edge must remain visible over light and dark imagery",
  );
}

for (const selector of [
  ".map-ui-satellite .fb-map-overlay-trigger",
  ".map-ui-satellite .fb-map-layer-panel",
  ".map-ui-satellite .fb-map-layer-toggle[aria-pressed=\"true\"]",
  ".map-ui-satellite .fb-map-layer-toggle:disabled",
  ".map-ui-satellite .fb-map-overlay-trigger:focus-visible",
  ".map-ui-satellite .fb-map-overlay-panel",
  ".map-ui-satellite .fb-map-overlay-option",
  ".map-ui-satellite .fb-map-overlay-success",
]) {
  assert.ok(css.includes(selector), `Missing satellite-only selector: ${selector}`);
}

for (const className of [
  "fb-map-layer-panel",
  "fb-map-layer-toggle",
  "fb-map-layer-toggle__status",
  "fb-map-layer-panel__eyebrow",
  "fb-map-layer-panel__summary",
  "fb-map-layer-panel__hint",
]) {
  assert.ok(panel.includes(className), `Map layer panel is missing ${className}`);
}
assert.doesNotMatch(
  panel,
  /fb-map-layer-(?:panel|toggle)[^"\n]*\bborder\b/,
  "Satellite-only borders must not change Standard or Topografisk layout",
);
assert.match(
  css,
  /\.map-ui-satellite \.fb-map-layer-panel\s*\{[^}]*border:\s*1px solid transparent/,
  "The map layer panel border width must be scoped to satellite mode",
);
assert.match(
  css,
  /\.map-ui-satellite \.fb-map-layer-toggle\s*\{[^}]*border:\s*1px solid transparent/,
  "Layer toggle border width must be scoped to satellite mode",
);
assert.ok(inspector.includes("fb-map-overlay-panel"), "Operating-area status panel must use the shared overlay surface");
assert.ok(inspector.includes("fb-map-overlay-option"), "Operating-area candidates must use the satellite-safe option surface");
assert.ok(inspector.includes("fb-map-overlay-success"), "Operating-area success state must use the satellite-safe success surface");
assert.ok(app.includes("fb-map-overlay-alert"), "Existing map errors must keep the shared alert surface");
assert.ok(mapCanvas.includes("fb-map-overlay-satellite-alert"), "Color-analysis instruction must use its satellite-only marker");
assert.match(
  css,
  /(?:^|,)\s*\.fb-map-overlay-alert\s*(?:,|\{)/m,
  "Existing map alerts must keep their Standard and Topografisk surface",
);
assert.doesNotMatch(
  css,
  /(?:^|,)\s*\.fb-map-overlay-satellite-alert\s*(?:,|\{)/m,
  "The color-analysis marker must not change Standard or Topografisk styling",
);
assert.match(
  css,
  /\.map-ui-satellite \.fb-map-overlay-satellite-alert\s*(?:,|\{)/,
  "The color-analysis marker must only receive contrast overrides in satellite mode",
);
assert.ok(colorAnalysisPopup.includes("fb-map-overlay-panel"), "Color-analysis result must use the shared overlay surface");
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*no-preference\)[\s\S]*?\.map-ui-satellite \.fb-map-overlay-trigger:hover:not\(:disabled\)[\s\S]*?transform:\s*translateY\(-1px\)/,
  "Satellite hover must have a non-color cue without forcing motion for reduced-motion users",
);
assert.match(
  css,
  /\.map-ui-satellite \.fb-map-overlay-trigger:hover:not\(:disabled\):not\(:focus-visible\)[\s\S]*?box-shadow:[\s\S]*?0 0 0 2px var\(--fb-map-control-primary\)[\s\S]*?0 0 0 4px var\(--fb-map-control-ring-dark\)/,
  "Satellite hover must keep a two-tone motion-free shape cue for reduced-motion users",
);

console.log("satellite map contrast tests passed");
