import type { OrthophotoOverlayDefinition } from "./orthophoto-overlays";
import { formatPropertyReference } from "./formatters";
import type { PhotoFeature, Property } from "../types";

export interface ComparisonImage {
  id: string;
  date: string;
  label: string;
  source: string;
  scope: string;
  propertyId?: number | null;
  imageUrl: string | null;
  thumbnailUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  viewLat?: number | null;
  viewLng?: number | null;
  headingDeg?: number | null;
  pitchDeg?: number | null;
  altitudeM?: number | null;
  locationUncertaintyM?: number | null;
  headingSource?: string | null;
  pitchSource?: string | null;
  viewMode?: string | null;
  viewConfidence?: number | null;
  bounds?: OrthophotoOverlayDefinition["bounds"];
  limitations?: string[];
  canonicalSource?: OrthophotoOverlayDefinition["canonicalSource"];
}
export function validBounds(bounds: ComparisonImage["bounds"]): bounds is NonNullable<ComparisonImage["bounds"]> {
  return Boolean(bounds && Object.values(bounds).every(Number.isFinite) && bounds.south < bounds.north && bounds.west < bounds.east);
}
export function overlappingBounds(a: ComparisonImage, b: ComparisonImage) {
  if (a.scope !== b.scope || !validBounds(a.bounds) || !validBounds(b.bounds)) return null;
  const bounds = {south: Math.max(a.bounds.south,b.bounds.south), north: Math.min(a.bounds.north,b.bounds.north), west: Math.max(a.bounds.west,b.bounds.west), east: Math.min(a.bounds.east,b.bounds.east)};
  return validBounds(bounds) ? bounds : null;
}
export function orthophotoComparisonImages(overlays: OrthophotoOverlayDefinition[], properties: Property[] = []): ComparisonImage[] {
  return overlays.map(item => ({id:item.id,date:item.capturedDate,label:item.label,source: `Ortofoto · webforhåndsvisning · ${item.label}`, scope:item.propertyReference,propertyId:properties.find(property => formatPropertyReference(property) === item.propertyReference)?.id ?? null,imageUrl:item.imageUrl,bounds:item.bounds,limitations:item.limitations,canonicalSource:item.canonicalSource}));
}
function hasCaptureDate(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === date;
}
export function photoComparisonImages(photos: PhotoFeature[]): ComparisonImage[] {
  const counts = new Map<string, number>();
  return photos.filter(item => item.property_id != null && hasCaptureDate(item.captured_date)).map(item => {
    const key = `${item.property_id}/${item.captured_date}`;
    const ordinal = (counts.get(key) ?? 0) + 1;
    counts.set(key, ordinal);
    return {id:item.id,date:item.captured_date,label:`Bilde ${ordinal}`,source:`Foto · ${item.title}`,scope:`Eiendom ${item.property_id}`,propertyId:item.property_id,imageUrl:item.image_url ?? item.thumbnail_url,thumbnailUrl:item.thumbnail_url,
      lat:item.lat,lng:item.lng,viewLat:item.view_lat,viewLng:item.view_lng,
      headingDeg:item.heading_deg,pitchDeg:item.pitch_deg,altitudeM:item.altitude_m,
      locationUncertaintyM:item.location_uncertainty_m,headingSource:item.heading_source,
      pitchSource:item.pitch_source,viewMode:item.view_mode,viewConfidence:item.view_confidence};
  });
}

export interface PhotoComparisonCandidate {
  image: ComparisonImage;
  distanceM: number;
  positionType: "view-target" | "camera";
  headingDifferenceDeg: number | null;
  pitchDifferenceDeg: number | null;
  directionStatus: "compatible" | "unknown";
  targetConfidence: number | null;
  targetConfidenceStatus: "reported" | "low" | "unknown";
}
export interface PhotoComparisonMatch {
  status: "matched" | "unknown-location" | "no-nearby-candidate";
  candidates: PhotoComparisonCandidate[];
  maxDistanceM: number;
}

// A deliberately bounded candidate search, not proof of shared ground coverage.
export const PHOTO_COMPARISON_MAX_DISTANCE_M = 30;
function point(lat: number | null | undefined, lng: number | null | undefined): [number, number] | null {
  return typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
    && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}
// Backend GeometryMethod: "point" copies camera GPS, while "estimated" and
// "manual" describe a ground target. Unknown modes must not invent a target.
function viewTarget(image: ComparisonImage): [number, number] | null {
  return image.viewMode === "estimated" || image.viewMode === "manual"
    ? point(image.viewLat, image.viewLng) : null;
}
function viewConfidence(image: ComparisonImage): number | null {
  return typeof image.viewConfidence === "number" && Number.isFinite(image.viewConfidence)
    && image.viewConfidence >= 0 && image.viewConfidence <= 1 ? image.viewConfidence : null;
}
function distanceMeters(a: [number, number], b: [number, number]) {
  const radians = Math.PI / 180;
  const dLat = (b[0] - a[0]) * radians;
  const dLng = (b[1] - a[1]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * radians) * Math.cos(b[0] * radians) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function pitch(image: ComparisonImage) {
  return typeof image.pitchDeg === "number" && Number.isFinite(image.pitchDeg) && Math.abs(image.pitchDeg) <= 90 ? image.pitchDeg : null;
}
function heading(image: ComparisonImage) {
  return typeof image.headingDeg === "number" && Number.isFinite(image.headingDeg) ? ((image.headingDeg % 360) + 360) % 360 : null;
}

/** Rank other-date photos from one property by nearby position.
 * Ground targets are compared only to ground targets; camera GPS is used only
 * when the anchor has no target. Missing direction remains explicitly unknown.
 * Neither GPS proximity nor matching camera angles establishes equal footprints.
 */
export function rankPhotoComparisonCandidates(reference: ComparisonImage, images: ComparisonImage[], targetDate?: string): PhotoComparisonMatch {
  const maxDistanceM = PHOTO_COMPARISON_MAX_DISTANCE_M;
  const target = viewTarget(reference);
  const origin = target ?? point(reference.lat, reference.lng);
  const positionType = target ? "view-target" : "camera";
  if (!origin || reference.propertyId == null) return {status:"unknown-location", candidates:[], maxDistanceM};
  const candidates: PhotoComparisonCandidate[] = [];
  let knownPositions = 0;
  for (const image of images) {
    if (image.id === reference.id || image.propertyId !== reference.propertyId || image.date === reference.date
      || !hasCaptureDate(image.date) || (targetDate && image.date !== targetDate) || !image.imageUrl) continue;
    const position = target ? viewTarget(image) : point(image.lat, image.lng);
    if (!position) continue;
    knownPositions += 1;
    const distanceM = distanceMeters(origin, position);
    if (distanceM > maxDistanceM) continue;
    // Reported uncertainty wider than the search window cannot locate a candidate.
    if ((reference.locationUncertaintyM ?? 0) > maxDistanceM || (image.locationUncertaintyM ?? 0) > maxDistanceM) continue;
    const aPitch = pitch(reference), bPitch = pitch(image);
    const pitchDifferenceDeg = aPitch == null || bPitch == null ? null : Math.abs(aPitch - bPitch);
    if (pitchDifferenceDeg != null && pitchDifferenceDeg > 20) continue;
    const aHeading = heading(reference), bHeading = heading(image);
    // Nadir yaw does not describe horizontal viewing direction.
    const bothNadir = aPitch != null && bPitch != null && aPitch <= -75 && bPitch <= -75;
    const bothOblique = aPitch != null && bPitch != null && aPitch > -75 && bPitch > -75;
    const headingDifferenceDeg = bothOblique && aHeading != null && bHeading != null
      ? Math.min(Math.abs(aHeading - bHeading), 360 - Math.abs(aHeading - bHeading)) : null;
    if (headingDifferenceDeg != null && headingDifferenceDeg > 45) continue;
    const directionStatus = bothNadir || (bothOblique && headingDifferenceDeg != null) ? "compatible" : "unknown";
    const aConfidence = target ? viewConfidence(reference) : null;
    const bConfidence = target ? viewConfidence(image) : null;
    const targetConfidence = aConfidence == null || bConfidence == null ? null : Math.min(aConfidence, bConfidence);
    // The backend quality model treats geometry confidence below .7 as uncertain.
    const targetConfidenceStatus = targetConfidence == null ? "unknown" : targetConfidence < 0.7 ? "low" : "reported";
    candidates.push({image, distanceM, positionType, headingDifferenceDeg, pitchDifferenceDeg, directionStatus, targetConfidence, targetConfidenceStatus});
  }
  candidates.sort((a,b) => a.distanceM - b.distanceM || a.image.date.localeCompare(b.image.date) || a.image.id.localeCompare(b.image.id));
  return {status:candidates.length ? "matched" : knownPositions ? "no-nearby-candidate" : "unknown-location", candidates, maxDistanceM};
}
