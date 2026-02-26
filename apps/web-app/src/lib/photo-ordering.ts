import type { PhotoFeature } from "@/types";

const MAX_NEAREST_PATH_PHOTOS = 900;

export function photoIdKey(id: string | number | null | undefined): string {
  return String(id ?? "");
}

export function mergePhotoPages(existing: PhotoFeature[], incoming: PhotoFeature[]): PhotoFeature[] {
  if (existing.length === 0) return incoming;
  if (incoming.length === 0) return existing;

  const seen = new Set(existing.map((photo) => photoIdKey(photo.id)));
  const next = [...existing];
  incoming.forEach((photo) => {
    const key = photoIdKey(photo.id);
    if (seen.has(key)) return;
    seen.add(key);
    next.push(photo);
  });
  return next;
}

export function compareByCapturedAtThenId(a: PhotoFeature, b: PhotoFeature): number {
  const aTime = Date.parse(a.captured_at);
  const bTime = Date.parse(b.captured_at);
  const safeATime = Number.isNaN(aTime) ? 0 : aTime;
  const safeBTime = Number.isNaN(bTime) ? 0 : bTime;
  const diff = safeATime - safeBTime;
  if (diff !== 0) return diff;
  return a.id.localeCompare(b.id);
}

function distanceScore(a: PhotoFeature, b: PhotoFeature): number {
  const latMidRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const lngFactor = Math.cos(latMidRad);
  const dx = (a.lng - b.lng) * lngFactor;
  const dy = a.lat - b.lat;
  return dx * dx + dy * dy;
}

export function buildNearestPath(photos: PhotoFeature[], anchorId: string): PhotoFeature[] {
  if (photos.length <= 1) return photos;
  if (photos.length > MAX_NEAREST_PATH_PHOTOS) {
    return [...photos].sort(compareByCapturedAtThenId);
  }

  const byId = new Map(photos.map((photo) => [photo.id, photo]));
  const anchor = byId.get(anchorId);
  if (!anchor) {
    return [...photos].sort(compareByCapturedAtThenId);
  }

  const remaining = new Map(byId);
  remaining.delete(anchorId);

  const ordered: PhotoFeature[] = [anchor];
  let current = anchor;

  while (remaining.size > 0) {
    let nextId: string | null = null;
    let nextPhoto: PhotoFeature | null = null;
    let best = Number.POSITIVE_INFINITY;

    remaining.forEach((candidate) => {
      const score = distanceScore(current, candidate);
      if (score < best) {
        best = score;
        nextPhoto = candidate;
        nextId = candidate.id;
        return;
      }
      if (score === best && nextPhoto && compareByCapturedAtThenId(candidate, nextPhoto) < 0) {
        nextPhoto = candidate;
        nextId = candidate.id;
      }
    });

    if (!nextPhoto || !nextId) break;
    ordered.push(nextPhoto);
    remaining.delete(nextId);
    current = nextPhoto;
  }

  return ordered;
}
