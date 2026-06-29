import type * as Leaflet from "leaflet";

import { analyzeOrthophotoColorPixels, ORTHOPHOTO_SAMPLE_SIZE_PX, type OrthophotoColorAnalysis } from "@/lib/orthophoto-color-analysis";
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
