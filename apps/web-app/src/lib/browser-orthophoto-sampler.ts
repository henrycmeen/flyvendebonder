import type * as Leaflet from "leaflet";

import { apiGet, ApiError } from "@/lib/api";
import {
  analyzeOrthophotoColorPixels,
  ORTHOPHOTO_SAMPLE_SIZE_PX,
  type OrthophotoColorAnalysis,
  type OrthophotoQualityFlag,
} from "@/lib/orthophoto-color-analysis";
import type { OrthophotoOverlayDefinition } from "@/lib/orthophoto-overlays";

export interface RenderedOrthophotoCandidate {
  overlay: OrthophotoOverlayDefinition;
  bounds: Leaflet.LatLngBounds;
  getImageElement: () => HTMLImageElement | null;
  supportsBrowserSampling: boolean;
}

export interface ProjectedImagePixel {
  x: number;
  y: number;
  ratioX: number;
  ratioY: number;
}

export interface OrthophotoColorAnalysisResult {
  status: "analysis";
  overlay: OrthophotoOverlayDefinition;
  analysis: OrthophotoColorAnalysis;
  imagePixel: ProjectedImagePixel;
  source: OrthophotoColorAnalysisSource;
}

export interface OrthophotoColorAnalysisUnavailable {
  status: "unavailable";
  overlay: OrthophotoOverlayDefinition | null;
  reason: string;
}

export interface OrthophotoColorAnalysisNoCoverage {
  status: "no_coverage";
  reason: string;
}

export type OrthophotoColorAnalysisOutcome =
  | OrthophotoColorAnalysisResult
  | OrthophotoColorAnalysisUnavailable
  | OrthophotoColorAnalysisNoCoverage;

export interface OrthophotoColorAnalysisSource {
  kind: "browser_overlay" | "backend_orthophoto";
  label: string;
  detail: string;
  sourceKind?: "canonical" | "preview" | "unknown";
  gsdMPerPx?: { x: number; y: number } | null;
  sourceWidthPx?: number;
  sourceHeightPx?: number;
}

interface BackendRgbTriplet {
  r: number;
  g: number;
  b: number;
}

interface BackendOrthophotoColorSample {
  overlay: {
    id: string;
    label: string;
    captured_date: string | null;
    property_reference: string | null;
  };
  source: {
    kind: "canonical" | "preview";
    path_basename: string;
    width_px: number;
    height_px: number;
    canonical_width_px: number;
    canonical_height_px: number;
    gsd_m_per_px: { x: number; y: number } | null;
  };
  point: {
    lat: number;
    lng: number;
  };
  image_pixel: {
    x: number;
    y: number;
    ratio_x: number;
    ratio_y: number;
  };
  analysis: {
    requested_size_px: number;
    sampled_width_px: number;
    sampled_height_px: number;
    requested_pixels: number;
    sampled_pixels: number;
    valid_pixels: number;
    clipped: boolean;
    mean_rgb: BackendRgbTriplet;
    median_rgb: BackendRgbTriplet;
    brightness: number;
    light_assessment: string;
    indices: {
      exg: number;
      vari: number;
      ngrdi: number;
      gli: number;
      ndyi: number;
    };
    quality_flags: string[];
  };
}

export function orthophotoBackendSampleToOutcome(
  overlay: OrthophotoOverlayDefinition,
  sample: BackendOrthophotoColorSample,
): OrthophotoColorAnalysisResult {
  const sourceKindLabel = sample.source.kind === "canonical" ? "kanonisk raster" : "backend-preview";
  return {
    status: "analysis",
    overlay,
    imagePixel: {
      x: sample.image_pixel.x,
      y: sample.image_pixel.y,
      ratioX: sample.image_pixel.ratio_x,
      ratioY: sample.image_pixel.ratio_y,
    },
    source: {
      kind: "backend_orthophoto",
      label: "Backend/ortofoto",
      detail: `${sourceKindLabel}: ${sample.source.path_basename}`,
      sourceKind: sample.source.kind,
      gsdMPerPx: sample.source.gsd_m_per_px,
      sourceWidthPx: sample.source.width_px,
      sourceHeightPx: sample.source.height_px,
    },
    analysis: {
      requestedSizePx: sample.analysis.requested_size_px,
      sampledWidthPx: sample.analysis.sampled_width_px,
      sampledHeightPx: sample.analysis.sampled_height_px,
      requestedPixels: sample.analysis.requested_pixels,
      sampledPixels: sample.analysis.sampled_pixels,
      validPixels: sample.analysis.valid_pixels,
      clipped: sample.analysis.clipped,
      meanRgb: sample.analysis.mean_rgb,
      medianRgb: sample.analysis.median_rgb,
      brightness: sample.analysis.brightness,
      lightAssessment: sample.analysis.light_assessment,
      indices: sample.analysis.indices,
      qualityFlags: sample.analysis.quality_flags as OrthophotoQualityFlag[],
    },
  };
}

export async function sampleBackendOrthophotoColorAtLatLng({
  overlay,
  latLng,
  sampleSizePx = ORTHOPHOTO_SAMPLE_SIZE_PX,
}: {
  overlay: OrthophotoOverlayDefinition;
  latLng: Leaflet.LatLng;
  sampleSizePx?: number;
}): Promise<OrthophotoColorAnalysisOutcome> {
  try {
    const response = await apiGet<BackendOrthophotoColorSample>(
      `/api/v1/orthophotos/${encodeURIComponent(overlay.id)}/color-sample`,
      {
        query: {
          lat: latLng.lat,
          lng: latLng.lng,
          sample_size_px: sampleSizePx,
        },
        cache: false,
        retries: 0,
        timeoutMs: 8_000,
      },
    );
    return orthophotoBackendSampleToOutcome(overlay, response.data);
  } catch (error) {
    return {
      status: "unavailable",
      overlay,
      reason:
        error instanceof ApiError && error.message
          ? `Backend-sampling feilet: ${error.message}`
          : "Backend-sampling feilet for dette ortofotoet.",
    };
  }
}

export function projectLayerPointToImagePixel({
  point,
  northWest,
  southEast,
  imageWidth,
  imageHeight,
}: {
  point: { x: number; y: number };
  northWest: { x: number; y: number };
  southEast: { x: number; y: number };
  imageWidth: number;
  imageHeight: number;
}): ProjectedImagePixel {
  const width = southEast.x - northWest.x;
  const height = southEast.y - northWest.y;
  const ratioX = width === 0 ? 0 : (point.x - northWest.x) / width;
  const ratioY = height === 0 ? 0 : (point.y - northWest.y) / height;

  return {
    x: ratioX * imageWidth,
    y: ratioY * imageHeight,
    ratioX,
    ratioY,
  };
}

function cropWindow(center: ProjectedImagePixel, imageWidth: number, imageHeight: number, requestedSizePx: number) {
  const half = Math.floor(requestedSizePx / 2);
  const centerX = Math.round(center.x);
  const centerY = Math.round(center.y);
  const requestedLeft = centerX - half;
  const requestedTop = centerY - half;
  const left = Math.max(0, requestedLeft);
  const top = Math.max(0, requestedTop);
  const right = Math.min(imageWidth, requestedLeft + requestedSizePx);
  const bottom = Math.min(imageHeight, requestedTop + requestedSizePx);

  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    clipped: left !== requestedLeft || top !== requestedTop || right !== requestedLeft + requestedSizePx || bottom !== requestedTop + requestedSizePx,
  };
}

function drawSample(image: HTMLImageElement, crop: ReturnType<typeof cropWindow>): ImageData {
  const canvas = document.createElement("canvas");
  canvas.width = crop.width;
  canvas.height = crop.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas er ikke tilgjengelig i nettleseren.");
  }
  context.drawImage(image, crop.left, crop.top, crop.width, crop.height, 0, 0, crop.width, crop.height);
  return context.getImageData(0, 0, crop.width, crop.height);
}

export function sampleOrthophotoColorAtLatLng({
  map,
  latLng,
  candidates,
  sampleSizePx = ORTHOPHOTO_SAMPLE_SIZE_PX,
}: {
  map: Leaflet.Map;
  latLng: Leaflet.LatLng;
  candidates: RenderedOrthophotoCandidate[];
  sampleSizePx?: number;
}): OrthophotoColorAnalysisOutcome {
  const matchingCandidates = candidates.filter((candidate) => candidate.bounds.contains(latLng)).reverse();
  if (matchingCandidates.length === 0) {
    return {
      status: "no_coverage",
      reason: "Punktet ligger utenfor synlige ortofoto for valgt eiendom, år og sesong.",
    };
  }

  for (const candidate of matchingCandidates) {
    if (!candidate.supportsBrowserSampling) {
      return {
        status: "unavailable",
        overlay: candidate.overlay,
        reason: "Dette ortofotoet vises som fliser. Nettleser-sampling bruker foreløpig bare live bildeoverlay.",
      };
    }

    const image = candidate.getImageElement();
    if (!image || !image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
      return {
        status: "unavailable",
        overlay: candidate.overlay,
        reason: "Ortofotoet laster fortsatt. Prøv igjen når bildet er synlig i kartet.",
      };
    }

    const imagePixel = projectLayerPointToImagePixel({
      point: map.latLngToLayerPoint(latLng),
      northWest: map.latLngToLayerPoint(candidate.bounds.getNorthWest()),
      southEast: map.latLngToLayerPoint(candidate.bounds.getSouthEast()),
      imageWidth: image.naturalWidth,
      imageHeight: image.naturalHeight,
    });
    const crop = cropWindow(imagePixel, image.naturalWidth, image.naturalHeight, sampleSizePx);

    if (crop.width === 0 || crop.height === 0) {
      continue;
    }

    try {
      const imageData = drawSample(image, crop);
      const analysis = analyzeOrthophotoColorPixels(imageData.data, imageData.width, imageData.height, {
        requestedSizePx: sampleSizePx,
        clipped: crop.clipped,
      });
      if (analysis.validPixels === 0) {
        continue;
      }

      return {
        status: "analysis",
        overlay: candidate.overlay,
        analysis,
        imagePixel,
        source: {
          kind: "browser_overlay",
          label: "Web-overlay",
          detail: "Piksler lest fra bildet som vises i nettleseren",
          sourceKind: candidate.overlay.tileLayer?.sourceKind,
          sourceWidthPx: image.naturalWidth,
          sourceHeightPx: image.naturalHeight,
        },
      };
    } catch (error) {
      return {
        status: "unavailable",
        overlay: candidate.overlay,
        reason:
          error instanceof Error && error.message
            ? `Kunne ikke lese pikslene fra ortofotoet: ${error.message}`
            : "Kunne ikke lese pikslene fra ortofotoet.",
      };
    }
  }

  return {
    status: "unavailable",
    overlay: matchingCandidates[0]?.overlay ?? null,
    reason: "Punktet traff bare transparente/no-data piksler i de synlige ortofotoene.",
  };
}
