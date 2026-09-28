import type { PhotoFeature } from "@/types";

export type PhotoMapPoint = [number, number];

export function validMapPoint(point: { lat: number | null; lng: number | null } | null | undefined): PhotoMapPoint | null {
  if (!point || point.lat == null || point.lng == null) return null;
  if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  if (Math.abs(point.lat) > 90 || Math.abs(point.lng) > 180) return null;
  return [point.lat, point.lng];
}

export function photoAnalysisTarget(photo: PhotoFeature): PhotoMapPoint | null {
  return validMapPoint(photo.analysis_zone?.center_point)
    ?? validMapPoint({ lat: photo.view_lat, lng: photo.view_lng });
}

// This is the camera's ground direction, not the drone body's flight yaw.
// A nadir photo has no horizontal viewing direction in a top-down map.
export function photoViewHeading(photo: PhotoFeature | null): number | null {
  if (!photo) return null;
  const source = validMapPoint(photo);
  const target = photoAnalysisTarget(photo);
  if (!source || !target) return null;
  const radians = Math.PI / 180;
  const lat1 = source[0] * radians;
  const lat2 = target[0] * radians;
  const deltaLng = (target[1] - source[1]) * radians;
  const north = (lat2 - lat1) * 6371000;
  const east = deltaLng * Math.cos((lat1 + lat2) / 2) * 6371000;
  if (Math.hypot(north, east) < 4) return null;
  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  return ((Math.atan2(y, x) / radians) + 360) % 360;
}
