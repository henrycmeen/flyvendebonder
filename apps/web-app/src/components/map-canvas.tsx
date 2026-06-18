import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";

import type { FieldPlot, FieldPlotDraft, FlightMission, GardskartJob, GeoJSONPolygon, GeoPoint, PhotoFeature, Property, VideoMapArtifact } from "@/types";
import { formatPropertyReference } from "@/lib/formatters";
import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import { DEV_ORTHOPHOTO_OVERLAYS } from "@/lib/orthophoto-overlays";
import { seasonFromCapturedDate, type SeasonOrMixed } from "@/lib/season-theme";

interface MapCanvasProps {
  photos: PhotoFeature[];
  selectedPhotoId: string | null;
  hoveredPhotoId: string | null;
  focusToken: number;
  resetViewToken: number;
  selectedYear: string;
  selectedSeason: SeasonOrMixed | "all";
  focusedOrthophotoId: string | null;
  orthophotoFocusToken: number;
  properties: Property[];
  jobs: GardskartJob[];
  videoMapArtifacts: VideoMapArtifact[];
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showZoomControls: boolean;
  showSoilLayer: boolean;
  showPropertyLayer: boolean;
  soilRefreshToken: number;
  fieldPlots: FieldPlot[];
  activeFieldDraft: FieldPlotDraft | null;
  flightMissions: FlightMission[];
  activeFlightMissionId: number | null;
  showMissionOverlay: boolean;
  fieldCreateMode: boolean;
  onRequestFieldCreateAt: (point: GeoPoint) => void;
  onSelectField: (fieldId: number) => void;
  onFieldGeometryChange: (geometry: GeoJSONPolygon) => void;
  onSelectPhoto: (photoId: string) => void;
  onHoverPhoto: (photoId: string | null) => void;
  onOpenPhotoFullscreen: (photoId: string) => void;
  onSoilStatus: (text: string) => void;
  onSoilTileError: () => void;
  onPropertyStatus: (text: string) => void;
  onPropertyTileError: (jobId: string) => void;
  onBaseMapTileError: (style: BaseMapStyle) => void;
  onDropMissingVideoArtifact: (jobId: string) => void;
}

const fallbackCenter: [number, number] = [59.1708, 9.6607];
const EARTH_RADIUS_M = 6_371_000;
const SOIL_WMS_URL = "https://wms.nibio.no/cgi-bin/jordkvalitet";
const SOIL_WMS_LAYER = "Jordkvalitet";
const SOIL_LAYER_OPACITY = 0.34;

type LatLngPair = [number, number];
type MediaKind = "drone" | "camera";
type MarkerSeason = SeasonOrMixed;

const mapCameraIconUrl = `${import.meta.env.BASE_URL}icon-marker-camera.svg`;

interface ClusterLike {
  getChildCount: () => number;
  getAllChildMarkers: () => L.Marker[];
}

function resolvePhotoSeason(photo: PhotoFeature | null): MarkerSeason {
  return seasonFromCapturedDate(photo?.captured_date);
}

function resolveClusterSeason(cluster: ClusterLike): MarkerSeason {
  const seasons = new Set<MarkerSeason>();
  const childMarkers = cluster.getAllChildMarkers() as Array<L.Marker & { _fbSeason?: MarkerSeason }>;
  childMarkers.forEach((marker) => {
    seasons.add(marker._fbSeason ?? "mixed");
  });

  if (seasons.size !== 1) {
    return "mixed";
  }
  const first = childMarkers[0]?._fbSeason ?? "mixed";
  return first;
}

function clusterSizeClass(count: number): "small" | "medium" | "large" {
  if (count < 10) return "small";
  if (count < 100) return "medium";
  return "large";
}

function inferMediaKind(photo: PhotoFeature): MediaKind {
  const haystack = [photo.title, ...(photo.tags ?? [])].join(" ").toLowerCase();
  if (haystack.includes("drone") || haystack.includes("dronefoto") || haystack.includes("dji")) {
    return "drone";
  }
  return "camera";
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPinClassName(active: boolean, photo: PhotoFeature | null): string {
  const base = `fb-media-pin${active ? " fb-media-pin--active" : ""}`;
  if (!photo || !photo.analysis) {
    return `${base} fb-media-pin--unknown`;
  }

  const confidence = photo.confidence_score ?? photo.analysis.confidence ?? 0;
  const isLowConfidence =
    (photo.analysis.approved === false && confidence < 0.7) || photo.needs_manual_qc || confidence < 0.72;
  if (isLowConfidence) {
    return `${base} fb-media-pin--low-confidence`;
  }

  if (photo.analysis.geometry_method === "estimated" && confidence < 0.9) {
    return `${base} fb-media-pin--low-confidence`;
  }

  return base;
}

function pinStatusTitle(photo: PhotoFeature): string {
  if (!photo.analysis) return "Analyse mangler";
  if (photo.analysis.approved) return "Godkjent analyse";
  if (photo.analysis.geometry_method === "estimated") return "Estimert posisjon";
  if (photo.analysis.geometry_method === "point") return "Punkt i posisjon";
  if (photo.analysis.geometry_method === "manual") return "Manuell";
  return "Analysering pågår";
}

function buildPinTitle(photo: PhotoFeature | null): string {
  if (!photo) {
    return "Foto";
  }

  const title = photo.title || "Foto";
  if (!photo.analysis) {
    return `${title} – analysetype ukjent`;
  }

  const conf =
    photo.confidence_score == null
      ? photo.analysis.confidence == null
        ? "ukjent"
        : `${Math.round(photo.analysis.confidence * 100)}%`
      : `${Math.round(Math.max(0, Math.min(1, photo.confidence_score)) * 100)}%`;
  return `${title} – ${pinStatusTitle(photo)} (${conf})`;
}

function toLatLngFromPoint(point: { lat: number; lng: number } | null | undefined): LatLngPair | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return [point.lat, point.lng];
}

function toPhotoLatLng(photo: PhotoFeature): LatLngPair | null {
  if (!Number.isFinite(photo.lat) || !Number.isFinite(photo.lng)) return null;
  return [photo.lat, photo.lng];
}

function toPolygonLatLngs(raw: number[][][] | null | undefined): LatLngPair[] {
  if (!raw || raw.length === 0 || !Array.isArray(raw[0])) return [];
  const parsed: (LatLngPair | null)[] = raw[0].map(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lat, lng];
  });
  return parsed.filter((item): item is LatLngPair => item !== null);
}

function toLineLatLngs(raw: unknown): LatLngPair[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [[lat, lng] as LatLngPair];
  });
}

function toPolygonCoordinates(points: LatLngPair[]): number[][][] {
  if (points.length === 0) return [];
  const ring = points.map(([lat, lng]) => [lng, lat]);
  const [firstLng, firstLat] = ring[0];
  const [lastLng, lastLat] = ring[ring.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    ring.push([firstLng, firstLat]);
  }
  return [ring];
}

function polygonBoundsCenter(points: LatLngPair[]): LatLngPair | null {
  if (points.length === 0) return null;
  const bounds = L.latLngBounds(points);
  if (!bounds.isValid()) return null;
  const center = bounds.getCenter();
  return [center.lat, center.lng];
}

function createPlainTextContent(text: string, className?: string): HTMLElement {
  const element = document.createElement("span");
  if (className) {
    element.className = className;
  }
  element.textContent = text;
  return element;
}

function normalizeHeading(headingDeg: number): number {
  return ((headingDeg % 360) + 360) % 360;
}

function projectByHeading(origin: L.LatLng, headingDeg: number, distanceM: number): L.LatLng {
  const headingRad = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const latRad = (origin.lat * Math.PI) / 180;

  const deltaLat = (Math.cos(headingRad) * distanceM) / EARTH_RADIUS_M;
  const deltaLng = (Math.sin(headingRad) * distanceM) / (EARTH_RADIUS_M * Math.cos(latRad));

  return L.latLng(origin.lat + (deltaLat * 180) / Math.PI, origin.lng + (deltaLng * 180) / Math.PI);
}

function getAnalysisTarget(photo: PhotoFeature): LatLngPair | null {
  if (photo.analysis_zone?.center_point) {
    return toLatLngFromPoint(photo.analysis_zone.center_point);
  }
  if (photo.view_lat == null || photo.view_lng == null) return null;
  return [photo.view_lat, photo.view_lng];
}

function bearingFromPoints(source: LatLngPair, target: LatLngPair): number | null {
  const lat1 = (source[0] * Math.PI) / 180;
  const lat2 = (target[0] * Math.PI) / 180;
  const deltaLng = ((target[1] - source[1]) * Math.PI) / 180;

  const y = Math.sin(deltaLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);
  if (!Number.isFinite(x) || !Number.isFinite(y) || (Math.abs(x) < 1e-12 && Math.abs(y) < 1e-12)) {
    return null;
  }

  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

function resolvePhotoHeading(photo: PhotoFeature | null): number | null {
  if (!photo) return null;

  const source = toPhotoLatLng(photo);
  const target = getAnalysisTarget(photo);
  if (source && target) {
    const bearing = bearingFromPoints(source, target);
    if (bearing != null) return bearing;
  }

  if (photo.heading_deg != null && Number.isFinite(photo.heading_deg)) {
    return normalizeHeading(photo.heading_deg);
  }

  return null;
}

function buildDronePinVisual(active: boolean, photo: PhotoFeature | null): string {
  const heading = resolvePhotoHeading(photo);
  const headingMarkup =
    heading == null
      ? ""
      : `<span class="fb-media-pin-heading ${active ? "fb-media-pin-heading--active" : "fb-media-pin-heading--inactive"}" aria-hidden="true" style="--pin-heading:${heading.toFixed(1)}deg;"><span class="fb-media-pin-heading-arrow"></span></span>`;

  return `${headingMarkup}<span class="fb-media-pin-core" aria-hidden="true"><span class="fb-media-pin-core-dot"></span></span>`;
}

function mapMediaPinIcon(
  kind: MediaKind,
  active: boolean,
  photo: PhotoFeature | null,
): L.DivIcon {
  const className = buildPinClassName(active, photo);
  const season = resolvePhotoSeason(photo);
  const pinVisual =
    kind === "drone"
      ? buildDronePinVisual(active, photo)
      : `<img src="${mapCameraIconUrl}" alt="" />`;
  return L.divIcon({
    className: "fb-media-pin-shell",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<span class="${className}" data-kind="${escapeHtmlAttribute(kind)}" data-season="${escapeHtmlAttribute(season)}" data-title="${escapeHtmlAttribute(buildPinTitle(photo))}">${pinVisual}</span>`,
  });
}

function createPopupContent(photo: PhotoFeature, onOpenFullscreen: () => void): HTMLElement {
  const photoImageUrl = photo.thumbnail_url || photo.image_url || "";
  const popupContent = document.createElement("div");
  popupContent.className = "photo-popup-card";

  if (photoImageUrl) {
    const popupImage = document.createElement("img");
    popupImage.src = photoImageUrl;
    popupImage.alt = photo.title || "Foto";
    popupImage.decoding = "async";
    popupImage.loading = "lazy";
    popupImage.tabIndex = 0;
    popupImage.setAttribute("role", "button");
    popupImage.setAttribute("aria-label", `Åpne ${photo.title || "foto"} i fullskjerm`);
    popupImage.addEventListener("click", onOpenFullscreen);
    popupImage.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpenFullscreen();
      }
    });
    popupContent.appendChild(popupImage);

    const popupFullscreenButton = document.createElement("button");
    popupFullscreenButton.type = "button";
    popupFullscreenButton.className = "photo-popup-card__open";
    popupFullscreenButton.setAttribute("aria-label", "Åpne i fullskjerm");
    popupFullscreenButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    popupFullscreenButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenFullscreen();
    });
    popupContent.appendChild(popupFullscreenButton);
    return popupContent;
  }

  const popupImagePlaceholder = document.createElement("div");
  popupImagePlaceholder.className = "photo-popup-card__empty";
  popupContent.appendChild(popupImagePlaceholder);
  return popupContent;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toStringValue(value: unknown): string | null {
  if (typeof value === "string") {
    const next = value.trim();
    return next.length > 0 ? next : null;
  }
  return null;
}

function collectLatLngPairs(raw: unknown): LatLngPair[] {
  const coordinates: LatLngPair[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;

    if (node.length >= 2 && isFiniteNumber(node[0]) && isFiniteNumber(node[1])) {
      const lat = node[1];
      const lng = node[0];
      coordinates.push([lat, lng]);
      return;
    }

    for (const child of node) {
      walk(child);
    }
  };
  walk(raw);
  return coordinates;
}

function extractGeojsonSegments(raw: unknown): LatLngPair[][] {
  const record = asRecord(raw);
  if (!record) return [];

  if (toStringValue(record.type)?.toLowerCase() === "featurecollection" && Array.isArray(record.features)) {
    return record.features
      .map((feature) => {
        const featureRecord = asRecord(feature);
        const geometry = asRecord(featureRecord?.geometry);
        return collectLatLngPairs(geometry?.coordinates);
      })
      .filter((segment) => segment.length > 0);
  }

  const geometry = asRecord(record.geometry);
  if (geometry) {
    return [collectLatLngPairs(geometry.coordinates)];
  }

  if (record.coordinates) {
    return [collectLatLngPairs(record.coordinates)];
  }

  return [];
}

function firstSegmentPoint(segments: LatLngPair[][]): LatLngPair | null {
  for (const segment of segments) {
    if (segment.length > 0) {
      return segment[0];
    }
  }
  return null;
}

function lastSegmentPoint(segments: LatLngPair[][]): LatLngPair | null {
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment && segment.length > 0) {
      return segment[segment.length - 1] ?? null;
    }
  }
  return null;
}

function flattenSegments(segments: LatLngPair[][]): LatLngPair[] {
  const points: LatLngPair[] = [];
  segments.forEach((segment) => {
    segment.forEach((point, pointIndex) => {
      if (pointIndex === 0 && points.length > 0) {
        const previous = points[points.length - 1];
        if (previous && previous[0] === point[0] && previous[1] === point[1]) {
          return;
        }
      }
      points.push(point);
    });
  });
  return points;
}

function shiftSegments(segments: LatLngPair[][], from: LatLngPair, to: LatLngPair): LatLngPair[][] {
  const deltaLat = to[0] - from[0];
  const deltaLng = to[1] - from[1];
  return segments.map((segment) => segment.map(([lat, lng]) => [lat + deltaLat, lng + deltaLng]));
}

function hashStringToHue(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) % 360;
  }
  return ((hash % 360) + 360) % 360;
}

function videoArtifactColor(seed: string, fallback: number): string {
  const hue = (hashStringToHue(seed) + fallback * 47) % 360;
  return `hsl(${hue}, 75%, 50%)`;
}

function appendPointsToBounds(bounds: L.LatLngBounds, points: LatLngPair[]): void {
  points.forEach(([lat, lng]) => {
    bounds.extend(L.latLng(lat, lng));
  });
}

const FALLBACK_MAX_ZOOM = 20;

function isNIBIOStatusOk(statusCode: number | null, statusDesc: string | null): boolean {
  const desc = (statusDesc ?? "").toLowerCase();
  return statusCode === null || statusCode === 0 || statusCode === 1 || desc.includes("response ok");
}

type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

function resetLeafletContainer(container: LeafletContainer): void {
  // Leaflet sets a private _leaflet_id on initialized containers.
  // When React StrictMode re-mounts effects, this can remain and make L.map() fail.
  container._leaflet_id = undefined;
  container.innerHTML = "";
}

function supportsHoverPointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function MapCanvas({
  photos,
  selectedPhotoId,
  hoveredPhotoId,
  focusToken,
  resetViewToken,
  selectedYear,
  selectedSeason,
  focusedOrthophotoId,
  orthophotoFocusToken,
  properties,
  jobs,
  videoMapArtifacts,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showZoomControls,
  showSoilLayer,
  showPropertyLayer,
  soilRefreshToken,
  fieldPlots,
  activeFieldDraft,
  flightMissions,
  activeFlightMissionId,
  showMissionOverlay,
  fieldCreateMode,
  onRequestFieldCreateAt,
  onSelectField,
  onFieldGeometryChange,
  onSelectPhoto,
  onHoverPhoto,
  onOpenPhotoFullscreen,
  onSoilStatus,
  onSoilTileError,
  onPropertyStatus,
  onPropertyTileError,
  onBaseMapTileError,
  onDropMissingVideoArtifact,
}: MapCanvasProps) {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const photoByIdRef = useRef<Map<string, PhotoFeature>>(new Map());
  const activeMarkerIdsRef = useRef<Set<string>>(new Set());
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const soilLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const orthophotoLayerRef = useRef<L.LayerGroup | null>(null);
  const propertyLayerRef = useRef<L.LayerGroup | null>(null);
  const fieldLayerRef = useRef<L.LayerGroup | null>(null);
  const fieldHandleLayerRef = useRef<L.LayerGroup | null>(null);
  const missionLayerRef = useRef<L.LayerGroup | null>(null);
  const viewLayerRef = useRef<L.LayerGroup | null>(null);
  const videoLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFitRef = useRef(false);
  const hasVideoFitRef = useRef(false);
  const selectedPhotoIdRef = useRef<string | null>(selectedPhotoId);
  const shouldShowZoomControls = showZoomControls && !isMobileViewport;

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const query = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobileViewport(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  const setMarkerActiveState = useCallback((photoId: string, active: boolean) => {
    const marker = markersByIdRef.current.get(photoId);
    if (!marker) return;

    const markerPhoto = photoByIdRef.current.get(photoId) ?? null;
    const kind = markerPhoto ? inferMediaKind(markerPhoto) : "drone";
    marker.setIcon(mapMediaPinIcon(kind, active, markerPhoto));
  }, []);

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) return;

    try {
      resetLeafletContainer(mapElementRef.current);
    } catch {
      /* no-op */
    }

    let map: L.Map;
    try {
      map = L.map(mapElementRef.current, {
        zoomControl: shouldShowZoomControls,
        attributionControl: true,
        maxZoom: FALLBACK_MAX_ZOOM,
      }).setView(fallbackCenter, 13);
    } catch (error) {
      console.error("Kunne ikke initialisere Leaflet-kart", error);
      return;
    }

    map.createPane("propertyPane");
    const propertyPane = map.getPane("propertyPane");
    if (propertyPane) {
      propertyPane.style.zIndex = "420";
      propertyPane.style.pointerEvents = "none";
      propertyPane.style.filter = "hue-rotate(170deg) saturate(1.35) brightness(0.98)";
      propertyPane.style.mixBlendMode = "screen";
    }

    map.createPane("soilPane");
    const soilPane = map.getPane("soilPane");
    if (soilPane) {
      soilPane.style.zIndex = "360";
      soilPane.style.pointerEvents = "none";
      soilPane.style.mixBlendMode = "multiply";
    }

    map.createPane("orthophotoPane");
    const orthophotoPane = map.getPane("orthophotoPane");
    if (orthophotoPane) {
      orthophotoPane.style.zIndex = "330";
      orthophotoPane.style.pointerEvents = "none";
    }

    map.createPane("laserPane");
    const laserPane = map.getPane("laserPane");
    if (laserPane) {
      laserPane.style.zIndex = "650";
      laserPane.style.pointerEvents = "none";
    }

    map.createPane("fieldPane");
    const fieldPane = map.getPane("fieldPane");
    if (fieldPane) {
      fieldPane.style.zIndex = "560";
    }

    map.createPane("missionPane");
    const missionPane = map.getPane("missionPane");
    if (missionPane) {
      missionPane.style.zIndex = "600";
      missionPane.style.pointerEvents = "none";
    }

    map.createPane("fieldHandlePane");
    const fieldHandlePane = map.getPane("fieldHandlePane");
    if (fieldHandlePane) {
      fieldHandlePane.style.zIndex = "670";
    }

    const clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
      maxClusterRadius: 48,
      chunkedLoading: true,
      chunkInterval: 90,
      chunkDelay: 20,
      iconCreateFunction: (cluster) => {
        const typedCluster = cluster as unknown as ClusterLike;
        const count = typedCluster.getChildCount();
        const season = resolveClusterSeason(typedCluster);
        const sizeClass = clusterSizeClass(count);
        return L.divIcon({
          html: `<div><span>${count}</span></div>`,
          className: `marker-cluster marker-cluster-${sizeClass} fb-season-cluster fb-season-cluster--${season}`,
          iconSize: L.point(40, 40),
        });
      },
    });
    map.addLayer(clusterLayer);
    const viewLayer = L.layerGroup();
    viewLayer.addTo(map);
    viewLayerRef.current = viewLayer;
    const missionLayer = L.layerGroup();
    missionLayer.addTo(map);
    missionLayerRef.current = missionLayer;
    const orthophotoLayer = L.layerGroup();
    orthophotoLayer.addTo(map);
    orthophotoLayerRef.current = orthophotoLayer;
    const videoLayer = L.layerGroup();
    videoLayer.addTo(map);
    videoLayerRef.current = videoLayer;

    mapRef.current = map;
    markersRef.current = clusterLayer;

    window.setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.invalidateSize();
      }
    }, 50);

    return () => {
      try {
        map.remove();
      } catch {
        /* no-op */
      } finally {
        const container = map.getContainer() as LeafletContainer | null;
        if (container) {
          container._leaflet_id = undefined;
        }
      }
      mapRef.current = null;
      markersRef.current = null;
      baseLayerRef.current = null;
      soilLayerRef.current = null;
      if (orthophotoLayerRef.current) {
        orthophotoLayerRef.current.remove();
        orthophotoLayerRef.current = null;
      }
      propertyLayerRef.current = null;
      if (fieldLayerRef.current) {
        fieldLayerRef.current.remove();
        fieldLayerRef.current = null;
      }
      if (fieldHandleLayerRef.current) {
        fieldHandleLayerRef.current.remove();
        fieldHandleLayerRef.current = null;
      }
      if (missionLayerRef.current) {
        missionLayerRef.current.remove();
        missionLayerRef.current = null;
      }
      if (viewLayerRef.current) {
        viewLayerRef.current.remove();
        viewLayerRef.current = null;
      }
      if (videoLayerRef.current) {
        videoLayerRef.current.remove();
        videoLayerRef.current = null;
      }
    };
  }, [shouldShowZoomControls]);

  useEffect(() => {
    const map = mapRef.current as (L.Map & { zoomControl?: L.Control.Zoom }) | null;
    if (!map?.zoomControl) return;
    if (shouldShowZoomControls) {
      map.zoomControl.addTo(map);
    } else {
      map.zoomControl.remove();
    }
  }, [shouldShowZoomControls]);

  useEffect(() => {
    const container = mapElementRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    let frame = 0;
    const observer = new ResizeObserver(() => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        mapRef.current?.invalidateSize({ pan: false, animate: false });
      });
    });

    observer.observe(container);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (baseLayerRef.current) {
      mapRef.current.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    const style = BASE_MAP_STYLES[baseMapStyle];
    if (!style.tileUrl) {
      return;
    }
    const layerOptions: L.TileLayerOptions = {
      maxZoom: style.maxZoom,
      attribution: style.attribution,
    };

    if (style.subdomains) {
      layerOptions.subdomains = style.subdomains;
    }

    const layer = L.tileLayer(style.tileUrl, layerOptions);
    layer.on("tileerror", () => {
      onBaseMapTileError(baseMapStyle);
    });

    layer.addTo(mapRef.current);
    baseLayerRef.current = layer;

    return () => {
      if (mapRef.current && layer) {
        mapRef.current.removeLayer(layer);
      }
    };
  }, [baseMapStyle, onBaseMapTileError]);

  useEffect(() => {
    if (!mapRef.current || !orthophotoLayerRef.current) return;

    const orthophotoLayer = orthophotoLayerRef.current;
    orthophotoLayer.clearLayers();

    const propertyReferences = new Set(properties.map((property) => formatPropertyReference(property)));
    const matchingOverlays = DEV_ORTHOPHOTO_OVERLAYS.filter((overlay) => {
      if (!propertyReferences.has(overlay.propertyReference)) return false;
      const [year] = overlay.capturedDate.split("-");
      if (selectedYear !== "all" && year !== selectedYear) return false;
      if (selectedSeason !== "all" && seasonFromCapturedDate(overlay.capturedDate) !== selectedSeason) return false;
      return true;
    }).sort((a, b) => {
      const byDate = a.capturedDate.localeCompare(b.capturedDate);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });
    if (matchingOverlays.length === 0) return;

    matchingOverlays.forEach((overlay) => {
      const bounds = L.latLngBounds(
        [overlay.bounds.south, overlay.bounds.west],
        [overlay.bounds.north, overlay.bounds.east],
      );
      if (overlay.tileLayer) {
        const tileLayer = L.tileLayer(overlay.tileLayer.urlTemplate, {
          pane: "orthophotoPane",
          opacity: overlay.opacity ?? 0.8,
          minZoom: 0,
          maxZoom: FALLBACK_MAX_ZOOM,
          minNativeZoom: overlay.tileLayer.minZoom,
          maxNativeZoom: overlay.tileLayer.maxNativeZoom,
          tileSize: overlay.tileLayer.tileSize,
          bounds,
          noWrap: true,
        });
        orthophotoLayer.addLayer(tileLayer);
        return;
      }

      const imageLayer = L.imageOverlay(overlay.imageUrl, bounds, {
        pane: "orthophotoPane",
        opacity: overlay.opacity ?? 0.8,
        interactive: false,
        crossOrigin: false,
      });
      orthophotoLayer.addLayer(imageLayer);
    });
  }, [properties, selectedSeason, selectedYear]);

  useEffect(() => {
    if (!mapRef.current || !focusedOrthophotoId) return;
    const overlay = DEV_ORTHOPHOTO_OVERLAYS.find((item) => item.id === focusedOrthophotoId);
    if (!overlay) return;
    const bounds = L.latLngBounds(
      [overlay.bounds.south, overlay.bounds.west],
      [overlay.bounds.north, overlay.bounds.east],
    );
    if (!bounds.isValid()) return;
    mapRef.current.fitBounds(bounds.pad(0.12), { animate: true });
  }, [focusedOrthophotoId, orthophotoFocusToken]);

  useEffect(() => {
    if (!mapRef.current) return;
    const tilePane = mapRef.current.getPane("tilePane");
    if (!tilePane) return;

    if (mapVintage) {
      tilePane.style.filter = "sepia(0.72) saturate(0.78) contrast(0.95) brightness(1.03)";
      return;
    }

    if (mapGrayscale) {
      tilePane.style.filter = "grayscale(1) contrast(1.04) saturate(0.75)";
      return;
    }

    tilePane.style.filter = "";
  }, [mapGrayscale, mapVintage]);

  useEffect(() => {
    selectedPhotoIdRef.current = selectedPhotoId;
  }, [selectedPhotoId]);

  useEffect(() => {
    const container = mapRef.current?.getContainer();
    if (!container) return;

    container.classList.toggle("fb-map-create-mode", fieldCreateMode);
    return () => {
      container.classList.remove("fb-map-create-mode");
    };
  }, [fieldCreateMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleMapClick = (event: L.LeafletMouseEvent) => {
      if (!fieldCreateMode) return;
      onRequestFieldCreateAt({ lat: event.latlng.lat, lng: event.latlng.lng });
    };

    map.on("click", handleMapClick);
    return () => {
      map.off("click", handleMapClick);
    };
  }, [fieldCreateMode, onRequestFieldCreateAt]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (fieldLayerRef.current) {
      mapRef.current.removeLayer(fieldLayerRef.current);
      fieldLayerRef.current = null;
    }
    if (fieldHandleLayerRef.current) {
      mapRef.current.removeLayer(fieldHandleLayerRef.current);
      fieldHandleLayerRef.current = null;
    }

    const fieldGroup = L.layerGroup();
    const handleGroup = L.layerGroup();
    const activeFieldId = activeFieldDraft?.id ?? null;

    fieldPlots.forEach((field) => {
      if (field.id === activeFieldId) return;
      const latLngs = toPolygonLatLngs(field.geometry.coordinates);
      if (latLngs.length < 4) return;

      const polygon = L.polygon(latLngs, {
        color: "rgba(191, 126, 63, 0.9)",
        fillColor: "rgba(244, 199, 112, 0.22)",
        fillOpacity: 0.14,
        weight: 1.6,
        opacity: 0.84,
        pane: "fieldPane",
        interactive: true,
        bubblingMouseEvents: false,
      });
      polygon.bindTooltip(createPlainTextContent(field.name ?? `Jord ${field.id}`));
      polygon.on("click", () => {
        onSelectField(field.id);
      });
      fieldGroup.addLayer(polygon);

      const centerPoint = polygonBoundsCenter(latLngs);
      if (centerPoint) {
        const label = L.marker(centerPoint, {
          pane: "fieldPane",
          interactive: false,
          keyboard: false,
          icon: L.divIcon({
            className: "fb-field-label-shell",
            html: createPlainTextContent(field.name ?? `Jord ${field.id}`, "fb-field-label"),
          }),
        });
        fieldGroup.addLayer(label);
      }
    });

    if (activeFieldDraft) {
      const latLngs = toPolygonLatLngs(activeFieldDraft.geometry.coordinates);
      if (latLngs.length >= 4) {
        const activePolygon = L.polygon(latLngs, {
          color: "rgba(199, 92, 36, 0.98)",
          fillColor: "rgba(243, 162, 87, 0.24)",
          fillOpacity: 0.22,
          weight: 2.8,
          opacity: 0.96,
          pane: "fieldPane",
          interactive: true,
          bubblingMouseEvents: false,
        });
        activePolygon.bindTooltip(createPlainTextContent(activeFieldDraft.name?.trim() || "Aktivt jordutkast"), {
          permanent: true,
          direction: "center",
          className: "fb-field-active-tooltip",
        });
        fieldGroup.addLayer(activePolygon);

        const handleIcon = L.divIcon({
          className: "fb-field-handle-shell",
          iconSize: [18, 18],
          iconAnchor: [9, 9],
          html: '<span class="fb-field-handle"></span>',
        });
        const editablePoints = latLngs.slice(0, -1);
        editablePoints.forEach((point, index) => {
          const handleMarker = L.marker(point, {
            draggable: true,
            icon: handleIcon,
            pane: "fieldHandlePane",
            keyboard: false,
            zIndexOffset: 600,
          });
          handleMarker.on("drag", () => {
            const nextPoint = handleMarker.getLatLng();
            const nextPoints: LatLngPair[] = editablePoints.map(([lat, lng], pointIndex) =>
              pointIndex === index ? ([nextPoint.lat, nextPoint.lng] as LatLngPair) : [lat, lng],
            );
            activePolygon.setLatLngs(nextPoints as L.LatLngExpression[]);
          });
          handleMarker.on("dragend", () => {
            const nextPoint = handleMarker.getLatLng();
            const nextPoints: LatLngPair[] = editablePoints.map(([lat, lng], pointIndex) =>
              pointIndex === index ? ([nextPoint.lat, nextPoint.lng] as LatLngPair) : [lat, lng],
            );
            onFieldGeometryChange({
              type: "Polygon",
              coordinates: toPolygonCoordinates(nextPoints),
            });
          });
          handleGroup.addLayer(handleMarker);
        });
      }
    }

    fieldGroup.addTo(mapRef.current);
    handleGroup.addTo(mapRef.current);
    fieldLayerRef.current = fieldGroup;
    fieldHandleLayerRef.current = handleGroup;

    return () => {
      if (mapRef.current) {
        mapRef.current.removeLayer(fieldGroup);
        mapRef.current.removeLayer(handleGroup);
      }
    };
  }, [activeFieldDraft, fieldPlots, onFieldGeometryChange, onSelectField]);

  useEffect(() => {
    if (!mapRef.current || !missionLayerRef.current) return;

    const missionLayer = missionLayerRef.current;
    missionLayer.clearLayers();
    if (!showMissionOverlay || activeFlightMissionId == null) return;

    const mission = flightMissions.find((item) => item.id === activeFlightMissionId);
    if (!mission) return;

    mission.fields.forEach((field) => {
      const latLngs = toPolygonLatLngs(field.geometry.coordinates);
      if (latLngs.length < 4) return;

      const polygon = L.polygon(latLngs, {
        color: "rgba(58, 109, 214, 0.96)",
        fillColor: "rgba(91, 140, 246, 0.16)",
        fillOpacity: 0.16,
        weight: 2.2,
        opacity: 0.95,
        pane: "missionPane",
        interactive: false,
      });
      polygon.bindTooltip(createPlainTextContent(`Oppdrag · ${field.name}`), {
        sticky: true,
      });
      missionLayer.addLayer(polygon);
    });

    mission.route_geojson.features.forEach((feature) => {
      if (!feature || typeof feature !== "object") return;
      const geometry = (feature as { geometry?: unknown }).geometry;
      if (!geometry || typeof geometry !== "object") return;

      const geometryType = (geometry as { type?: unknown }).type;
      if (geometryType === "LineString") {
        const latLngs = toLineLatLngs((geometry as { coordinates?: unknown }).coordinates);
        if (latLngs.length < 2) return;
        missionLayer.addLayer(
          L.polyline(latLngs, {
            color: "#5b8cf6",
            weight: 2.8,
            opacity: 0.96,
            lineCap: "round",
            pane: "missionPane",
            interactive: false,
          }),
        );
        return;
      }

      if (geometryType === "Point") {
        const latLngs = toLineLatLngs([(geometry as { coordinates?: unknown }).coordinates]);
        const point = latLngs[0];
        if (!point) return;
        missionLayer.addLayer(
          L.circleMarker(point, {
            radius: 3.8,
            color: "#f4f8ff",
            weight: 1.4,
            fillColor: "#5b8cf6",
            fillOpacity: 0.95,
            pane: "missionPane",
            interactive: false,
          }),
        );
      }
    });
  }, [activeFlightMissionId, flightMissions, showMissionOverlay]);

  useEffect(() => {
    if (!mapRef.current || !viewLayerRef.current) return;

    viewLayerRef.current.clearLayers();

    const hoverCapable = supportsHoverPointer();
    const activeDirectionPhotoId = hoverCapable ? hoveredPhotoId ?? selectedPhotoId : selectedPhotoId;
    if (!activeDirectionPhotoId) return;

    const selectedPhoto = photos.find((photo) => photo.id === activeDirectionPhotoId) ?? null;
    if (!selectedPhoto) return;

    const sourcePoint = toPhotoLatLng(selectedPhoto);
    if (sourcePoint == null) return;

    const source = L.latLng(sourcePoint[0], sourcePoint[1]);
    const target = getAnalysisTarget(selectedPhoto);
    if (target != null) {
      const targetLatLng = L.latLng(target[0], target[1]);
      if (source.distanceTo(targetLatLng) >= 4) {
        const line = L.polyline([source, targetLatLng], {
          className: "fb-media-viewline",
          color: "#f08d4f",
          weight: 2.8,
          opacity: 0.92,
          lineCap: "round",
          interactive: false,
          pane: "laserPane",
        });

        const targetPoint = L.circleMarker(targetLatLng, {
          className: "fb-media-view-target",
          radius: 4.5,
          color: "var(--fb-map-analysis-accent)",
          fillColor: "var(--fb-map-analysis-fill)",
          fillOpacity: 1,
          weight: 1.8,
          opacity: 0.94,
          interactive: false,
          pane: "laserPane",
        });

        viewLayerRef.current.addLayer(line);
        viewLayerRef.current.addLayer(targetPoint);

        if (selectedPhoto.analysis_zone?.footprint_polygon?.coordinates) {
          const footprint = toPolygonLatLngs(selectedPhoto.analysis_zone.footprint_polygon.coordinates);
          if (footprint.length > 3) {
            const footprintLayer = L.polygon(footprint, {
              color: "var(--fb-map-analysis-line)",
              fillColor: "var(--fb-map-analysis-line-soft)",
              fillOpacity: 0.2,
              weight: 1.4,
              opacity: 0.8,
              dashArray: "3 7",
              interactive: false,
              pane: "laserPane",
            });
            viewLayerRef.current.addLayer(footprintLayer);
          }
        }

        if (selectedPhoto.location_uncertainty_m != null && Number.isFinite(selectedPhoto.location_uncertainty_m)) {
          const radius = Math.max(1.4, Math.min(selectedPhoto.location_uncertainty_m, 50));
          const uncertaintyCircle = L.circle(targetLatLng, {
            radius,
            color: "var(--fb-map-analysis-line)",
            fillColor: "var(--fb-map-analysis-line-soft-strong)",
            fillOpacity: 0.12,
            weight: 1.2,
            interactive: false,
            pane: "laserPane",
          });
          viewLayerRef.current.addLayer(uncertaintyCircle);
        }

        if (selectedPhoto.analysis_zone?.sample_points?.length) {
          for (const samplePoint of selectedPhoto.analysis_zone.sample_points) {
            const sampleLatLng = toLatLngFromPoint(samplePoint);
            if (!sampleLatLng) continue;
            viewLayerRef.current.addLayer(
              L.circleMarker(sampleLatLng, {
                radius: 2.4,
                color: "var(--fb-map-analysis-accent)",
                fillColor: "var(--fb-map-analysis-fill)",
                fillOpacity: 0.95,
                weight: 1,
                opacity: 0.9,
                interactive: false,
                pane: "laserPane",
              }),
            );
          }
        }
      }
      return;
    }

    const fallbackHeading = resolvePhotoHeading(selectedPhoto);
    if (fallbackHeading != null) {
      const headingPoint = projectByHeading(source, fallbackHeading, 26);
      viewLayerRef.current.addLayer(
        L.polyline([source, headingPoint], {
          className: "fb-media-viewline",
          color: "#f08d4f",
          weight: 2.4,
          opacity: 0.88,
          lineCap: "round",
          interactive: false,
          pane: "laserPane",
        }),
      );
      viewLayerRef.current.addLayer(
        L.circleMarker(headingPoint, {
          className: "fb-media-view-target",
          radius: 3.6,
          color: "var(--fb-map-analysis-accent)",
          fillColor: "var(--fb-map-analysis-fill)",
          fillOpacity: 0.98,
          weight: 1.4,
          opacity: 0.92,
          interactive: false,
          pane: "laserPane",
        }),
      );
    }
  }, [hoveredPhotoId, photos, selectedPhotoId]);

  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;

    const desktopHover = supportsHoverPointer();

    markersRef.current.clearLayers();
    markersByIdRef.current.clear();
    photoByIdRef.current = new Map(photos.map((photo) => [photo.id, photo]));
    activeMarkerIdsRef.current = new Set();

    const photosWithCoordinates = photos
      .map((photo) => ({
        photo,
        point: toPhotoLatLng(photo),
      }))
      .filter((entry): entry is { photo: PhotoFeature; point: LatLngPair } => entry.point !== null);

    photosWithCoordinates.forEach(({ photo, point }) => {
      const mediaKind = inferMediaKind(photo);
      const marker = L.marker(point, {
        icon: mapMediaPinIcon(mediaKind, false, photo),
      });
      (marker as L.Marker & { _fbSeason?: MarkerSeason })._fbSeason = resolvePhotoSeason(photo);

      const openInFullscreen = () => {
        onOpenPhotoFullscreen(photo.id);
      };

      marker.bindPopup(() => createPopupContent(photo, openInFullscreen), {
        className: "fb-leaflet-popup",
        closeButton: false,
      });

      marker.on("click", () => {
        onSelectPhoto(photo.id);
        if (desktopHover) {
          onHoverPhoto(null);
          onOpenPhotoFullscreen(photo.id);
          return;
        }
        marker.openPopup();
      });
      marker.on("mouseover", () => {
        if (!desktopHover) return;
        onHoverPhoto(photo.id);
        const element = marker.getElement();
        if (element) {
          const pin = element.querySelector(".fb-media-pin");
          if (pin) {
            pin.classList.add("is-hover");
          }
        }
      });
      marker.on("mouseout", () => {
        if (!desktopHover) return;
        onHoverPhoto(null);
        const element = marker.getElement();
        if (element) {
          const pin = element.querySelector(".fb-media-pin");
          if (pin) {
            pin.classList.remove("is-hover");
          }
        }
      });

      markersRef.current?.addLayer(marker);
      markersByIdRef.current.set(photo.id, marker);
    });

    if (photosWithCoordinates.length > 0 && !hasFitRef.current) {
      const bounds = L.latLngBounds(photosWithCoordinates.map((entry) => entry.point));
      mapRef.current.fitBounds(bounds.pad(0.2), { animate: true });
      hasFitRef.current = true;
      return;
    }

    if (photos.length === 0) {
      hasFitRef.current = false;
    }
  }, [onHoverPhoto, onOpenPhotoFullscreen, onSelectPhoto, photos]);

  useEffect(() => {
    const hoverCapable = supportsHoverPointer();
    const nextActiveIds = new Set<string>();
    if (hoverCapable) {
      if (hoveredPhotoId) nextActiveIds.add(hoveredPhotoId);
    } else {
      if (selectedPhotoId) nextActiveIds.add(selectedPhotoId);
      if (hoveredPhotoId) nextActiveIds.add(hoveredPhotoId);
    }

    const prevActiveIds = activeMarkerIdsRef.current;
    const changedIds = new Set<string>([...prevActiveIds, ...nextActiveIds]);
    changedIds.forEach((photoId) => {
      setMarkerActiveState(photoId, nextActiveIds.has(photoId));
    });
    activeMarkerIdsRef.current = nextActiveIds;
  }, [hoveredPhotoId, photos, selectedPhotoId, setMarkerActiveState]);

  useEffect(() => {
    if (!mapRef.current) return;
    const targetPhotoId = selectedPhotoIdRef.current;
    if (!targetPhotoId) return;

    const marker = markersByIdRef.current.get(targetPhotoId);
    if (!marker) return;

    const latLng = marker.getLatLng();
    const targetZoom = Math.max(mapRef.current.getZoom(), 14);
    const cluster = markersRef.current as unknown as {
      zoomToShowLayer?: (layer: L.Layer, callback: () => void) => void;
    } | null;
    const desktopHover = supportsHoverPointer();

    const focusAndOpen = () => {
      if (!mapRef.current) return;
      mapRef.current.setView(latLng, targetZoom, { animate: true });
      if (desktopHover) {
        marker.closePopup();
        return;
      }
      marker.openPopup();
    };

    if (cluster?.zoomToShowLayer) {
      cluster.zoomToShowLayer(marker, focusAndOpen);
      return;
    }

    focusAndOpen();
  }, [focusToken]);

  useEffect(() => {
    if (!mapRef.current) return;
    mapRef.current.setView(fallbackCenter, 13, { animate: true });
  }, [resetViewToken]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (soilLayerRef.current) {
      mapRef.current.removeLayer(soilLayerRef.current);
      soilLayerRef.current = null;
    }

    if (!showSoilLayer) {
      return;
    }

    onSoilStatus("Jordsmonnlag lastes ...");

    let tileErrorHandled = false;
    let didSetActiveStatus = false;
    const layer = L.tileLayer.wms(SOIL_WMS_URL, {
      layers: SOIL_WMS_LAYER,
      styles: "",
      format: "image/png",
      transparent: true,
      version: "1.3.0",
      maxZoom: BASE_MAP_STYLES[baseMapStyle].maxZoom,
      opacity: SOIL_LAYER_OPACITY,
      pane: "soilPane",
      attribution: "NIBIO Jordkvalitet",
    });

    const markLoaded = () => {
      if (didSetActiveStatus) return;
      didSetActiveStatus = true;
      onSoilStatus("Jordsmonnlag aktivt.");
    };

    layer.once("load", markLoaded);
    layer.on("tileload", markLoaded);
    layer.on("tileerror", () => {
      if (tileErrorHandled) return;
      tileErrorHandled = true;
      onSoilStatus("Jordsmonnlag feilet. Prøver automatisk oppfriskning ...");
      onSoilTileError();
    });

    layer.addTo(mapRef.current);
    soilLayerRef.current = layer;

    return () => {
      if (mapRef.current && layer) {
        mapRef.current.removeLayer(layer);
      }
    };
  }, [baseMapStyle, onSoilStatus, onSoilTileError, showSoilLayer, soilRefreshToken]);

  useEffect(() => {
    if (!mapRef.current) return;

    if (propertyLayerRef.current) {
      mapRef.current.removeLayer(propertyLayerRef.current);
      propertyLayerRef.current = null;
    }

    if (!showPropertyLayer) {
      onPropertyStatus("Eiendomslag er skrudd av.");
      return;
    }

    if (properties.length === 0) {
      onPropertyStatus("Ingen aktive eiendommer tilgjengelig.");
      return;
    }

    if (jobs.length === 0) {
      onPropertyStatus("Eiendomslag venter på gyldig jobId ...");
      return;
    }

    const jobByPropertyId = new Map(jobs.map((job) => [job.property_id, job]));
    const matchedProperties = properties.filter((property) => jobByPropertyId.has(property.id));
    if (matchedProperties.length === 0) {
      onPropertyStatus("Eiendomslag venter på gyldig jobId ...");
      return;
    }

    const layerGroup = L.layerGroup();
    matchedProperties.forEach((property) => {
      const job = jobByPropertyId.get(property.id);
      if (!job) return;

      const wmsOptions: L.WMSOptions & { maxZoom?: number; [key: string]: unknown } = {
        layers: "eiendomsgrenser",
        styles: "default",
        format: "image/png",
        transparent: true,
        version: "1.3.0",
        maxZoom: BASE_MAP_STYLES[baseMapStyle].maxZoom,
        jobid: job.job_id,
        pane: "propertyPane",
        attribution: "NIBIO Gårdskart",
      };

      const layer = L.tileLayer.wms("https://wms.nibio.no/cgi-bin/gardskart", wmsOptions);
      layer.on("tileerror", () => {
        onPropertyStatus("Eiendomslag feilet. Prøver automatisk oppfriskning ...");
        onPropertyTileError(job.job_id);
      });

      layerGroup.addLayer(layer);
    });

    const staleCount = matchedProperties.filter((property) => {
      const job = jobByPropertyId.get(property.id);
      return job?.source === "stale-cache";
    }).length;
    const warningCount = matchedProperties.filter((property) => {
      const job = jobByPropertyId.get(property.id);
      return job ? !isNIBIOStatusOk(job.status_code, job.status_desc) : false;
    }).length;

    if (matchedProperties.length < properties.length) {
      onPropertyStatus(`Eiendomslag delvis aktivt (${matchedProperties.length} av ${properties.length} eiendommer).`);
    } else if (staleCount > 0) {
      onPropertyStatus("Eiendomslag bruker cache pga feil mot NIBIO. Se teknisk logg.");
    } else if (warningCount > 0) {
      if (matchedProperties.length === 1) {
        onPropertyStatus(`Eiendomslag aktivt (${formatPropertyReference(matchedProperties[0])}). NIBIO meldte avvik, se teknisk logg.`);
      } else {
        onPropertyStatus(`Eiendomslag aktivt (${matchedProperties.length} eiendommer), men NIBIO meldte avvik på ${warningCount}.`);
      }
    } else if (matchedProperties.length === 1) {
      onPropertyStatus(`Eiendomslag aktivt (${formatPropertyReference(matchedProperties[0])})`);
    } else {
      onPropertyStatus(`Eiendomslag aktivt (${matchedProperties.length} eiendommer).`);
    }

    layerGroup.addTo(mapRef.current);
    propertyLayerRef.current = layerGroup;

    return () => {
      if (mapRef.current && layerGroup) {
        mapRef.current.removeLayer(layerGroup);
      }
    };
  }, [jobs, onPropertyStatus, onPropertyTileError, properties, showPropertyLayer, baseMapStyle]);

  useEffect(() => {
    if (!mapRef.current || !videoLayerRef.current) return;

    videoLayerRef.current.clearLayers();
    hasVideoFitRef.current = false;

    if (videoMapArtifacts.length === 0) {
      return;
    }

    const abortControllers: AbortController[] = [];
    const hoverTimeouts: number[] = [];
    let cancelled = false;
    const bounds = L.latLngBounds([]);

    const loadArtifact = async (artifact: VideoMapArtifact, index: number): Promise<void> => {
      const geodataUrl = artifact.map3dResult?.geodata_geojson;
      if (!geodataUrl) return;

      const controller = new AbortController();
      abortControllers.push(controller);

      const response = await fetch(geodataUrl, { signal: controller.signal });
      if (!response.ok) {
        if (response.status === 404 || response.status === 410) {
          onDropMissingVideoArtifact(artifact.jobId);
          return;
        }
        throw new Error(`Kunne ikke hente geodata for ${artifact.jobId}`);
      }

      const payload = (await response.json()) as unknown;
      const segments = extractGeojsonSegments(payload);
      if (!segments.length) return;

      const startPoint = firstSegmentPoint(segments);
      const placedSegments =
        artifact.placement && startPoint
          ? shiftSegments(segments, startPoint, [artifact.placement.lat, artifact.placement.lng])
          : segments;

      const color = videoArtifactColor(artifact.jobId, index);
      const text = `Videoløype ${artifact.jobId.slice(0, 8)}`;
      const segmentGroup = L.layerGroup();
      const hoverOnly = supportsHoverPointer();
      const routeSegments = placedSegments.filter((segment) => segment.length >= 2);
      const flattenedRoute = flattenSegments(routeSegments.length > 0 ? routeSegments : placedSegments);
      const routeStart = flattenedRoute[0] ?? firstSegmentPoint(placedSegments);
      const routeEnd = lastSegmentPoint(routeSegments.length > 0 ? routeSegments : placedSegments);

      if (!routeStart) return;

      const routeLayers: L.Polyline[] = [];
      let endMarker: L.CircleMarker | null = null;
      let startMarker: L.CircleMarker | null = null;
      let hideTimer: number | null = null;

      const clearHideTimer = () => {
        if (hideTimer !== null) {
          window.clearTimeout(hideTimer);
          hideTimer = null;
        }
      };

      const setHoverVisibility = (visible: boolean) => {
        const routeOpacity = hoverOnly ? (visible ? 0.95 : 0) : 0.95;
        const endOpacity = hoverOnly ? (visible ? 0.98 : 0) : 0.98;

        routeLayers.forEach((line) => {
          line.setStyle({
            opacity: routeOpacity,
            weight: visible ? 3.8 : 3,
          });
        });
        if (endMarker) {
          endMarker.setStyle({
            opacity: endOpacity,
            fillOpacity: hoverOnly ? (visible ? 0.88 : 0) : 0.88,
            radius: visible ? 5.5 : 4.5,
          });
        }
        if (startMarker) {
          startMarker.setStyle({
            radius: visible ? 7 : 6,
            weight: visible ? 2.8 : 2.2,
            fillOpacity: 1,
          });
        }
      };

      const showRoute = () => {
        clearHideTimer();
        setHoverVisibility(true);
      };

      const hideRoute = () => {
        if (!hoverOnly) return;
        clearHideTimer();
        hideTimer = window.setTimeout(() => {
          setHoverVisibility(false);
        }, 120);
        hoverTimeouts.push(hideTimer);
      };

      const bindHoverHandlers = (layer: L.Layer) => {
        layer.on("mouseover", showRoute);
        layer.on("mouseout", hideRoute);
      };

      routeSegments.forEach((segment) => {
        const line = L.polyline(segment, {
          color,
          weight: 3,
          opacity: hoverOnly ? 0 : 0.95,
          dashArray: "8 8",
          interactive: hoverOnly,
        });
        line.bindTooltip(`${text} • rute`);
        bindHoverHandlers(line);
        routeLayers.push(line);
        segmentGroup.addLayer(line);
        appendPointsToBounds(bounds, segment);
      });

      startMarker = L.circleMarker(routeStart, {
        radius: 6,
        color,
        fillColor: color,
        fillOpacity: 0.95,
        weight: 2.2,
        opacity: 1,
      });
      startMarker.bindTooltip(`${text} • start`);
      bindHoverHandlers(startMarker);
      startMarker.on("click", showRoute);
      segmentGroup.addLayer(startMarker);
      appendPointsToBounds(bounds, [routeStart]);

      if (routeEnd && (routeEnd[0] !== routeStart[0] || routeEnd[1] !== routeStart[1])) {
        endMarker = L.circleMarker(routeEnd, {
          radius: 4.5,
          color,
          fillColor: color,
          fillOpacity: hoverOnly ? 0 : 0.88,
          weight: 1.5,
          opacity: hoverOnly ? 0 : 0.98,
        });
        endMarker.bindTooltip(`${text} • slutt`);
        bindHoverHandlers(endMarker);
        segmentGroup.addLayer(endMarker);
        appendPointsToBounds(bounds, [routeEnd]);
      }

      setHoverVisibility(!hoverOnly);
      videoLayerRef.current?.addLayer(segmentGroup);
    };

    const run = async () => {
      for (let index = 0; index < videoMapArtifacts.length; index += 1) {
        try {
          await loadArtifact(videoMapArtifacts[index], index);
        } catch (error) {
          if (cancelled || (error instanceof DOMException && error.name === "AbortError")) {
            return;
          }
          if (!cancelled) {
            console.error("Kunne ikke laste video-geodata", error);
          }
        }
      }

      if (!cancelled && bounds.isValid()) {
        mapRef.current?.fitBounds(bounds.pad(0.18), { animate: true });
        hasVideoFitRef.current = true;
      }
    };

    void run();

    return () => {
      cancelled = true;
      abortControllers.forEach((controller) => {
        controller.abort();
      });
      hoverTimeouts.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
    };
  }, [onDropMissingVideoArtifact, videoMapArtifacts]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={mapElementRef} className="absolute inset-0" aria-label="Kart med geotaggede bilder" />
      {mapVintage ? <div className="map-vintage-overlay" aria-hidden="true" /> : null}
    </div>
  );
}
