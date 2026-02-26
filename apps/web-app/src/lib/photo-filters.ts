import type { PhotoFeature } from "@/types";

import { splitCapturedDate } from "@/lib/formatters";
import { monthToSeason, type SeasonFilter } from "@/lib/season-theme";

export interface PhotoFilterOptions {
  selectedYear: string;
  selectedSeason: SeasonFilter;
  showOnlyManualQc: boolean;
  showOnlyLowConfidence: boolean;
  lowConfidenceThreshold: number;
}

export function makePhotoFilter({
  selectedYear,
  selectedSeason,
  showOnlyManualQc,
  showOnlyLowConfidence,
  lowConfidenceThreshold,
}: PhotoFilterOptions): (photo: PhotoFeature) => boolean {
  return (photo) => {
    const dateParts = splitCapturedDate(photo.captured_date);
    if (!dateParts) return false;
    if (selectedYear !== "all" && dateParts.year !== selectedYear) return false;
    if (selectedSeason !== "all" && monthToSeason(dateParts.month) !== selectedSeason) return false;
    if (showOnlyManualQc && !photo.needs_manual_qc) return false;
    if (
      showOnlyLowConfidence &&
      (photo.confidence_score == null || photo.confidence_score > lowConfidenceThreshold)
    ) {
      return false;
    }
    return true;
  };
}
