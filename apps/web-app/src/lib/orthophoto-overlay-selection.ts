import type { OrthophotoOverlayDefinition } from "@/lib/orthophoto-overlays";
import type { SeasonOrMixed } from "@/lib/season-theme";
import { seasonFromCapturedDate } from "@/lib/season-theme";

interface VisibleOrthophotoOverlayParams {
  overlays: OrthophotoOverlayDefinition[];
  propertyReferences: Set<string>;
  selectedYear: string;
  selectedSeason: SeasonOrMixed | "all";
}

export function sortOrthophotoOverlaysForDisplay(
  overlays: OrthophotoOverlayDefinition[],
): OrthophotoOverlayDefinition[] {
  return [...overlays].sort((a, b) => {
    const byDate = a.capturedDate.localeCompare(b.capturedDate);
    if (byDate !== 0) return byDate;
    return a.id.localeCompare(b.id);
  });
}

export function selectVisibleOrthophotoOverlays({
  overlays,
  propertyReferences,
  selectedYear,
  selectedSeason,
}: VisibleOrthophotoOverlayParams): OrthophotoOverlayDefinition[] {
  return sortOrthophotoOverlaysForDisplay(
    overlays.filter((overlay) => {
      if (!propertyReferences.has(overlay.propertyReference)) return false;
      const [year] = overlay.capturedDate.split("-");
      if (selectedYear !== "all" && year !== selectedYear) return false;
      if (selectedSeason !== "all" && seasonFromCapturedDate(overlay.capturedDate) !== selectedSeason) return false;
      return true;
    }),
  );
}

export function getOrthophotoSamplingOrder(
  overlays: OrthophotoOverlayDefinition[],
): OrthophotoOverlayDefinition[] {
  return [...overlays].reverse();
}
