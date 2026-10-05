import type { OrthophotoOverlayDefinition } from "./orthophoto-overlays";
import type { PhotoFeature } from "../types";

export interface ComparisonImage {
  id: string;
  date: string;
  label: string;
  source: string;
  scope: string;
  imageUrl: string | null;
  bounds?: OrthophotoOverlayDefinition["bounds"];
}
export function validBounds(bounds: ComparisonImage["bounds"]): bounds is NonNullable<ComparisonImage["bounds"]> {
  return Boolean(bounds && Object.values(bounds).every(Number.isFinite) && bounds.south < bounds.north && bounds.west < bounds.east);
}
export function overlappingBounds(a: ComparisonImage, b: ComparisonImage) {
  if (a.scope !== b.scope || !validBounds(a.bounds) || !validBounds(b.bounds)) return null;
  const bounds = {south: Math.max(a.bounds.south,b.bounds.south), north: Math.min(a.bounds.north,b.bounds.north), west: Math.max(a.bounds.west,b.bounds.west), east: Math.min(a.bounds.east,b.bounds.east)};
  return validBounds(bounds) ? bounds : null;
}
export function orthophotoComparisonImages(overlays: OrthophotoOverlayDefinition[]): ComparisonImage[] {
  return overlays.map(item => ({id:item.id,date:item.capturedDate,label:item.label,source: `Ortofoto · webforhåndsvisning · ${item.label}`, scope:item.propertyReference,imageUrl:item.imageUrl,bounds:item.bounds}));
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
    return {id:item.id,date:item.captured_date,label:`Bilde ${ordinal}`,source:`Foto · ${item.title}`,scope:`Eiendom ${item.property_id}`,imageUrl:item.image_url ?? item.thumbnail_url};
  });
}
