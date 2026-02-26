import type { BaseMapStyle } from "@/lib/map-styles";
import { BASE_MAP_STYLES } from "@/lib/map-styles";
import { useCallback, useEffect, useState } from "react";

const PREF_MAP_STYLE_KEY = "fb.map.baseStyle";
const PREF_MAP_STYLE_MANUAL_KEY = "fb.map.baseStyle.manual";
const PREF_MAP_GRAYSCALE_KEY = "fb.map.grayscale";
const PREF_MAP_VINTAGE_KEY = "fb.map.vintage";

const normalizeBaseMapStyle = (value: string | null): BaseMapStyle | null => {
  if (value === null) return null;
  return value in BASE_MAP_STYLES ? (value as BaseMapStyle) : null;
};

interface UseMapPreferencesResult {
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  setBaseMapStyle: (next: BaseMapStyle) => void;
  setMapGrayscale: (next: boolean) => void;
  setMapVintage: (next: boolean) => void;
  markMapStyleAsManual: () => void;
}

export function useMapPreferences(): UseMapPreferencesResult {
  const [baseMapStyle, setBaseMapStyle] = useState<BaseMapStyle>("osm");
  const [mapGrayscale, setMapGrayscale] = useState(false);
  const [mapVintage, setMapVintage] = useState(false);

  useEffect(() => {
    const storedStyle = normalizeBaseMapStyle(window.localStorage.getItem(PREF_MAP_STYLE_KEY));
    setBaseMapStyle(storedStyle ?? "osm");

    const storedGrayscale = window.localStorage.getItem(PREF_MAP_GRAYSCALE_KEY);
    if (storedGrayscale === "1") {
      setMapGrayscale(true);
    }

    const storedVintage = window.localStorage.getItem(PREF_MAP_VINTAGE_KEY);
    if (storedVintage === "1") {
      setMapVintage(true);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_STYLE_KEY, baseMapStyle);
  }, [baseMapStyle]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_GRAYSCALE_KEY, mapGrayscale ? "1" : "0");
  }, [mapGrayscale]);

  useEffect(() => {
    window.localStorage.setItem(PREF_MAP_VINTAGE_KEY, mapVintage ? "1" : "0");
  }, [mapVintage]);

  const markMapStyleAsManual = useCallback(() => {
    window.localStorage.setItem(PREF_MAP_STYLE_MANUAL_KEY, "1");
  }, []);

  return {
    baseMapStyle,
    mapGrayscale,
    mapVintage,
    setBaseMapStyle,
    setMapGrayscale,
    setMapVintage,
    markMapStyleAsManual,
  };
}
