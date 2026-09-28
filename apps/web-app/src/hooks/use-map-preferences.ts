import type { BaseMapStyle } from "@/lib/map-styles";
import {
  normalizeBaseMapStyle,
  normalizeMapTonePreferences,
  readStoredMapPreference,
  setMapTonePreference,
  writeStoredMapPreference,
  type MapTonePreferences,
} from "@/lib/map-preferences";
import { useCallback, useEffect, useState } from "react";

const PREF_MAP_STYLE_KEY = "fb.map.baseStyle";
const PREF_MAP_GRAYSCALE_KEY = "fb.map.grayscale";
const PREF_MAP_VINTAGE_KEY = "fb.map.vintage";
const PREF_MAP_ZOOM_CONTROLS_KEY = "fb.map.zoomControls";

interface UseMapPreferencesResult {
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showZoomControls: boolean;
  setBaseMapStyle: (next: BaseMapStyle) => void;
  setMapGrayscale: (next: boolean) => void;
  setMapVintage: (next: boolean) => void;
  setShowZoomControls: (next: boolean) => void;
}

export function useMapPreferences(): UseMapPreferencesResult {
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>(() => {
    return normalizeBaseMapStyle(readStoredMapPreference(PREF_MAP_STYLE_KEY)) ?? "osm";
  });
  const [mapTonePreferences, setMapTonePreferences] = useState<MapTonePreferences>(() =>
    normalizeMapTonePreferences(
      readStoredMapPreference(PREF_MAP_GRAYSCALE_KEY) === "1",
      readStoredMapPreference(PREF_MAP_VINTAGE_KEY) === "1",
    ),
  );
  const [showZoomControls, setShowZoomControls] = useState(() => {
    const stored = readStoredMapPreference(PREF_MAP_ZOOM_CONTROLS_KEY);
    return stored == null ? true : stored === "1";
  });

  useEffect(() => {
    writeStoredMapPreference(PREF_MAP_STYLE_KEY, baseMapStyle);
  }, [baseMapStyle]);

  useEffect(() => {
    writeStoredMapPreference(PREF_MAP_GRAYSCALE_KEY, mapTonePreferences.mapGrayscale ? "1" : "0");
  }, [mapTonePreferences.mapGrayscale]);

  useEffect(() => {
    writeStoredMapPreference(PREF_MAP_VINTAGE_KEY, mapTonePreferences.mapVintage ? "1" : "0");
  }, [mapTonePreferences.mapVintage]);

  useEffect(() => {
    writeStoredMapPreference(PREF_MAP_ZOOM_CONTROLS_KEY, showZoomControls ? "1" : "0");
  }, [showZoomControls]);

  const setMapGrayscale = useCallback((next: boolean) => {
    setMapTonePreferences((current) => setMapTonePreference(current, "mapGrayscale", next));
  }, []);

  const setMapVintage = useCallback((next: boolean) => {
    setMapTonePreferences((current) => setMapTonePreference(current, "mapVintage", next));
  }, []);

  return {
    baseMapStyle,
    mapGrayscale: mapTonePreferences.mapGrayscale,
    mapVintage: mapTonePreferences.mapVintage,
    showZoomControls,
    setBaseMapStyle,
    setMapGrayscale,
    setMapVintage,
    setShowZoomControls,
  };
}
