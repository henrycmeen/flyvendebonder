export const ORTHOPHOTO_SAMPLE_SIZE_PX = 21;
const ALPHA_VALID_THRESHOLD = 16;
const EPSILON = 0.0001;

export type OrthophotoQualityFlag =
  | "edge_clipped"
  | "low_valid_pixels"
  | "transparent_or_nodata"
  | "dark_sample"
  | "shadow_risk"
  | "bright_sample"
  | "overexposed_pixels"
  | "possible_soil_or_background";

export const ORTHOPHOTO_QUALITY_FLAG_LABELS: Record<OrthophotoQualityFlag, string> = {
  edge_clipped: "Kantklippet prøveflate",
  low_valid_pixels: "Få gyldige piksler",
  transparent_or_nodata: "Transparente/no-data piksler",
  dark_sample: "Mørkt utsnitt",
  shadow_risk: "Mulig skygge",
  bright_sample: "Lyst utsnitt",
  overexposed_pixels: "Mulig overeksponering",
  possible_soil_or_background: "Mulig jord/bakgrunn",
};

export interface RgbTriplet {
  r: number;
  g: number;
  b: number;
}

export interface OrthophotoVegetationIndices {
  exg: number;
  vari: number;
  ngrdi: number;
  gli: number;
  ndyi: number;
}

export interface OrthophotoColorAnalysis {
  requestedSizePx: number;
  sampledWidthPx: number;
  sampledHeightPx: number;
  requestedPixels: number;
  sampledPixels: number;
  validPixels: number;
  clipped: boolean;
  meanRgb: RgbTriplet;
  medianRgb: RgbTriplet;
  brightness: number;
  lightAssessment: string;
  indices: OrthophotoVegetationIndices;
  qualityFlags: OrthophotoQualityFlag[];
}

export interface AnalyzeOrthophotoColorPixelsOptions {
  requestedSizePx?: number;
  clipped?: boolean;
}

interface PixelAccumulator {
  rValues: number[];
  gValues: number[];
  bValues: number[];
  brightnessValues: number[];
  indices: {
    exg: number[];
    vari: number[];
    ngrdi: number[];
    gli: number[];
    ndyi: number[];
  };
  darkPixels: number;
  overexposedPixels: number;
  transparentPixels: number;
}

function safeRatio(numerator: number, denominator: number): number {
  if (Math.abs(denominator) < EPSILON) return 0;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : 0;
}

function round(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function emptyAccumulator(): PixelAccumulator {
  return {
    rValues: [],
    gValues: [],
    bValues: [],
    brightnessValues: [],
    indices: {
      exg: [],
      vari: [],
      ngrdi: [],
      gli: [],
      ndyi: [],
    },
    darkPixels: 0,
    overexposedPixels: 0,
    transparentPixels: 0,
  };
}

function lightAssessment(brightness: number): string {
  if (brightness < 0.16) return "Mørkt utsnitt";
  if (brightness < 0.3) return "Lavt lys / mulig skygge";
  if (brightness > 0.88) return "Svært lyst / mulig overeksponering";
  if (brightness > 0.72) return "Lyst utsnitt";
  return "Balansert lys";
}

function buildQualityFlags(
  accumulator: PixelAccumulator,
  validPixels: number,
  requestedPixels: number,
  clipped: boolean,
  brightness: number,
  indices: OrthophotoVegetationIndices,
): OrthophotoQualityFlag[] {
  const flags = new Set<OrthophotoQualityFlag>();
  const sampledPixels = Math.max(1, validPixels + accumulator.transparentPixels);

  if (clipped) flags.add("edge_clipped");
  if (validPixels < requestedPixels * 0.55) flags.add("low_valid_pixels");
  if (accumulator.transparentPixels > sampledPixels * 0.15) flags.add("transparent_or_nodata");
  if (brightness < 0.18) flags.add("dark_sample");
  if (accumulator.darkPixels > validPixels * 0.22) flags.add("shadow_risk");
  if (brightness > 0.74) flags.add("bright_sample");
  if (accumulator.overexposedPixels > validPixels * 0.08) flags.add("overexposed_pixels");
  if (indices.exg < 0.05 && indices.gli < 0.04) flags.add("possible_soil_or_background");

  return [...flags];
}

export function analyzeOrthophotoColorPixels(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  options: AnalyzeOrthophotoColorPixelsOptions = {},
): OrthophotoColorAnalysis {
  const sampledWidthPx = Math.max(0, Math.floor(width));
  const sampledHeightPx = Math.max(0, Math.floor(height));
  const requestedSizePx = options.requestedSizePx ?? ORTHOPHOTO_SAMPLE_SIZE_PX;
  const requestedPixels = requestedSizePx * requestedSizePx;
  const sampledPixels = sampledWidthPx * sampledHeightPx;
  const accumulator = emptyAccumulator();

  for (let offset = 0; offset + 3 < rgba.length; offset += 4) {
    const alpha = rgba[offset + 3];
    if (alpha < ALPHA_VALID_THRESHOLD) {
      accumulator.transparentPixels += 1;
      continue;
    }

    const rRaw = rgba[offset];
    const gRaw = rgba[offset + 1];
    const bRaw = rgba[offset + 2];
    const r = rRaw / 255;
    const g = gRaw / 255;
    const b = bRaw / 255;
    const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    accumulator.rValues.push(rRaw);
    accumulator.gValues.push(gRaw);
    accumulator.bValues.push(bRaw);
    accumulator.brightnessValues.push(brightness);
    accumulator.indices.exg.push(2 * g - r - b);
    accumulator.indices.vari.push(safeRatio(g - r, g + r - b));
    accumulator.indices.ngrdi.push(safeRatio(g - r, g + r));
    accumulator.indices.gli.push(safeRatio(2 * g - r - b, 2 * g + r + b));
    accumulator.indices.ndyi.push(safeRatio(g - b, g + b));

    if (brightness < 0.12) accumulator.darkPixels += 1;
    if (rRaw >= 248 || gRaw >= 248 || bRaw >= 248) accumulator.overexposedPixels += 1;
  }

  const validPixels = accumulator.rValues.length;
  const meanRgb = {
    r: round(mean(accumulator.rValues), 1),
    g: round(mean(accumulator.gValues), 1),
    b: round(mean(accumulator.bValues), 1),
  };
  const medianRgb = {
    r: round(median(accumulator.rValues), 1),
    g: round(median(accumulator.gValues), 1),
    b: round(median(accumulator.bValues), 1),
  };
  const brightness = round(mean(accumulator.brightnessValues), 3);
  const indices = {
    exg: round(mean(accumulator.indices.exg), 4),
    vari: round(mean(accumulator.indices.vari), 4),
    ngrdi: round(mean(accumulator.indices.ngrdi), 4),
    gli: round(mean(accumulator.indices.gli), 4),
    ndyi: round(mean(accumulator.indices.ndyi), 4),
  };

  return {
    requestedSizePx,
    sampledWidthPx,
    sampledHeightPx,
    requestedPixels,
    sampledPixels,
    validPixels,
    clipped: options.clipped ?? sampledPixels !== requestedPixels,
    meanRgb,
    medianRgb,
    brightness,
    lightAssessment: lightAssessment(brightness),
    indices,
    qualityFlags: buildQualityFlags(
      accumulator,
      validPixels,
      requestedPixels,
      options.clipped ?? sampledPixels !== requestedPixels,
      brightness,
      indices,
    ),
  };
}
