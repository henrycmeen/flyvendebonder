interface MapHoverPreviewState {
  isMapView: boolean;
  hasPreviewPhoto: boolean;
  hasPreviewImage: boolean;
  isPhotoViewerOpen: boolean;
  isTimelineFilterExpanded: boolean;
  isLayerPanelExpanded: boolean;
  isOperatingAreaToolActive: boolean;
  isColorAnalysisActive: boolean;
  hasPhotoLoadError: boolean;
}

export function shouldShowMapHoverPreview(state: MapHoverPreviewState): boolean {
  return (
    state.isMapView &&
    state.hasPreviewPhoto &&
    state.hasPreviewImage &&
    !state.isPhotoViewerOpen &&
    !state.isTimelineFilterExpanded &&
    !state.isLayerPanelExpanded &&
    !state.isOperatingAreaToolActive &&
    !state.isColorAnalysisActive &&
    !state.hasPhotoLoadError
  );
}

export function shouldShowOperatingAreaInspector(options: {
  isToolActive: boolean;
  isLayerPanelExpanded: boolean;
}): boolean {
  return options.isToolActive && !options.isLayerPanelExpanded;
}
