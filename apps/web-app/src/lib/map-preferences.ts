import { BASE_MAP_STYLE_ORDER, type BaseMapStyle } from "./map-styles.ts";

export interface MapTonePreferences {
  mapGrayscale: boolean;
  mapVintage: boolean;
}

export type MapTonePreference = keyof MapTonePreferences;

export function normalizeBaseMapStyle(value: string | null): BaseMapStyle | null {
  if (value === null) return null;
  return BASE_MAP_STYLE_ORDER.includes(value as BaseMapStyle) ? (value as BaseMapStyle) : null;
}

export function normalizeMapTonePreferences(mapGrayscale: boolean, mapVintage: boolean): MapTonePreferences {
  return mapVintage ? { mapGrayscale: false, mapVintage: true } : { mapGrayscale, mapVintage: false };
}

export function setMapTonePreference(
  current: MapTonePreferences,
  preference: MapTonePreference,
  next: boolean,
): MapTonePreferences {
  const normalized = normalizeMapTonePreferences(current.mapGrayscale, current.mapVintage);

  if (preference === "mapGrayscale") {
    return { mapGrayscale: next, mapVintage: next ? false : normalized.mapVintage };
  }

  return { mapGrayscale: next ? false : normalized.mapGrayscale, mapVintage: next };
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredMapPreference(key: string): string | null {
  const storage = getLocalStorage();
  if (!storage) return null;

  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStoredMapPreference(key: string, value: string): void {
  const storage = getLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // Preferences are a convenience; blocked storage must not break the map.
  }
}
