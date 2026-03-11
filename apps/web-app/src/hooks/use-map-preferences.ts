import type { BaseMapStyle } from "@/lib/map-styles";
import { BASE_MAP_STYLES } from "@/lib/map-styles";
import { useEffect, useState } from "react";

const PREF_MAP_STYLE_KEY = "fb.map.baseStyle";
const PREF_MAP_GRAYSCALE_KEY = "fb.map.grayscale";
const PREF_MAP_VINTAGE_KEY = "fb.map.vintage";
const PREF_MAP_ZOOM_CONTROLS_KEY = "fb.map.zoomControls";

const normalizeBaseMapStyle = (value: string | null): BaseMapStyle | null => {
  if (value === null) return null;
  return value in BASE_MAP_STYLES ? (value as BaseMapStyle) : null;
};

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
    if (typeof window === "undefined") return "osm";
    return normalizeBaseMapStyle(window.localStorage.getItem(PREF_MAP_STYLE_KEY)) ?? "osm";
  });
  const [mapGrayscale, setMapGrayscale] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PREF_MAP_GRAYSCALE_KEY) === "1";
  });
  const [mapVintage, setMapVintage] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(PREF_MAP_VINTAGE_KEY) === "1";
  });
  const [showZoomControls, setShowZoomControls] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(PREF_MAP_ZOOM_CONTROLS_KEY);
    return stored == null ? true : stored === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_STYLE_KEY, baseMapStyle);
  }, [baseMapStyle]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_GRAYSCALE_KEY, mapGrayscale ? "1" : "0");
  }, [mapGrayscale]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_VINTAGE_KEY, mapVintage ? "1" : "0");
  }, [mapVintage]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_ZOOM_CONTROLS_KEY, showZoomControls ? "1" : "0");
  }, [showZoomControls]);

  return {
    baseMapStyle,
    mapGrayscale,
    mapVintage,
    showZoomControls,
    setBaseMapStyle,
    setMapGrayscale,
    setMapVintage,
    setShowZoomControls,
  };
}
