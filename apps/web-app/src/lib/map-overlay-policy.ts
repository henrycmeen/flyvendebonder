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

export function resolveMapControlVisibility(options: {
  hasPhotoLoadError: boolean;
  isOperatingAreaToolActive: boolean;
  isLayerPanelExpanded: boolean;
}): {
  showPhotoLoadAlert: boolean;
  showLayerPanel: boolean;
  showOperatingAreaInspector: boolean;
} {
  return {
    showPhotoLoadAlert: options.hasPhotoLoadError,
    showLayerPanel: !options.hasPhotoLoadError,
    showOperatingAreaInspector: shouldShowOperatingAreaInspector({
      isToolActive: options.isOperatingAreaToolActive,
      isLayerPanelExpanded: options.isLayerPanelExpanded,
    }),
  };
}
