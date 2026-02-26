import { useEffect, useRef } from "react";
import L from "leaflet";

import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import type { PhotoFeature } from "@/types";

interface PhotoMapInsetProps {
  photo: PhotoFeature;
  baseMapStyle: BaseMapStyle;
  editable?: boolean;
  manualTarget?: { lat: number; lng: number } | null;
  onManualTargetChange?: ((target: { lat: number; lng: number } | null) => void) | undefined;
}

type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

const EARTH_RADIUS_M = 6371000;
const MIN_CONTEXT_RADIUS_M = 55;

function normalizeHeading(headingDeg: number): number {
  return ((headingDeg % 360) + 360) % 360;
}

function toLatLngFromPoint(point: { lat: number; lng: number } | null | undefined): [number, number] | null {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return null;
  return [point.lat, point.lng];
}

function getAnalysisTarget(
  photo: PhotoFeature,
  manualTarget: { lat: number; lng: number } | null | undefined,
): [number, number] | null {
  if (manualTarget && Number.isFinite(manualTarget.lat) && Number.isFinite(manualTarget.lng)) {
    return [manualTarget.lat, manualTarget.lng];
  }
  if (photo.analysis_zone?.center_point) {
    return toLatLngFromPoint(photo.analysis_zone.center_point);
  }
  if (photo.view_lat == null || photo.view_lng == null) return null;
  return [photo.view_lat, photo.view_lng];
}

function toPolygonLatLngs(raw: number[][][] | null | undefined): [number, number][] {
  if (!raw || raw.length === 0 || !Array.isArray(raw[0])) return [];
  return raw[0]
    .map(([lng, lat]) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
      return [lat, lng];
    })
    .filter((point): point is [number, number] => point !== null);
}

function projectByHeading(origin: L.LatLng, headingDeg: number, distanceM: number): L.LatLng {
  const headingRad = (normalizeHeading(headingDeg) * Math.PI) / 180;
  const latRad = (origin.lat * Math.PI) / 180;

  const deltaLat = (Math.cos(headingRad) * distanceM) / EARTH_RADIUS_M;
  const deltaLng = (Math.sin(headingRad) * distanceM) / (EARTH_RADIUS_M * Math.cos(latRad));

  return L.latLng(origin.lat + (deltaLat * 180) / Math.PI, origin.lng + (deltaLng * 180) / Math.PI);
}

function expandBoundsWithContext(bounds: L.LatLngBounds, minRadiusM: number): L.LatLngBounds {
  const center = bounds.getCenter();
  return bounds
    .extend(projectByHeading(center, 0, minRadiusM))
    .extend(projectByHeading(center, 90, minRadiusM))
    .extend(projectByHeading(center, 180, minRadiusM))
    .extend(projectByHeading(center, 270, minRadiusM));
}

function resetLeafletContainer(container: LeafletContainer): void {
  container._leaflet_id = undefined;
  container.innerHTML = "";
}

function manualTargetIcon(): L.DivIcon {
  return L.divIcon({
    className: "photo-viewer-map-target-handle-shell",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: '<span class="photo-viewer-map-target-handle"></span>',
  });
}

export function PhotoMapInset({
  photo,
  baseMapStyle,
  editable = false,
  manualTarget,
  onManualTargetChange,
}: PhotoMapInsetProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) return;

    try {
      resetLeafletContainer(mapElementRef.current);
    } catch {
      /* no-op */
    }

    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      preferCanvas: true,
      zoomSnap: 0.25,
    });

    mapRef.current = map;
    overlayRef.current = L.layerGroup().addTo(map);

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
      baseLayerRef.current = null;
      overlayRef.current = null;
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
    const options: L.TileLayerOptions = {
      maxZoom: style.maxZoom,
      attribution: style.attribution,
    };
    if (style.subdomains) {
      options.subdomains = style.subdomains;
    }

    const tileLayer = L.tileLayer(style.tileUrl, options);
    tileLayer.addTo(mapRef.current);
    baseLayerRef.current = tileLayer;
  }, [baseMapStyle]);

  useEffect(() => {
    if (!mapRef.current) return;
    if (!editable || !onManualTargetChange) return;

    const map = mapRef.current;
    const clickHandler = (event: L.LeafletMouseEvent) => {
      onManualTargetChange({ lat: event.latlng.lat, lng: event.latlng.lng });
    };
    map.on("click", clickHandler);

    return () => {
      map.off("click", clickHandler);
    };
  }, [editable, onManualTargetChange]);

  useEffect(() => {
    if (!mapRef.current || !overlayRef.current) return;

    const overlay = overlayRef.current;
    overlay.clearLayers();

    const sourcePoint = toLatLngFromPoint(photo);
    if (!sourcePoint) {
      return;
    }

    const source = L.latLng(sourcePoint[0], sourcePoint[1]);
    const points: L.LatLng[] = [source];
    const targetPointCoordinates = getAnalysisTarget(photo, manualTarget);

    L.circleMarker(source, {
      radius: 4.5,
      color: "var(--fb-map-analysis-accent)",
      weight: 1.3,
      fillColor: "var(--fb-map-analysis-fill)",
      fillOpacity: 0.94,
      opacity: 0.96,
      interactive: false,
    }).addTo(overlay);

    if (targetPointCoordinates != null) {
      const target = L.latLng(targetPointCoordinates[0], targetPointCoordinates[1]);
      points.push(target);

      L.polyline([source, target], {
        color: "var(--fb-map-analysis-line)",
        weight: 2.3,
        opacity: 0.98,
        dashArray: photo.view_mode === "estimated" && !manualTarget ? "4 6" : undefined,
        lineCap: "round",
        interactive: false,
      }).addTo(overlay);

      if (editable) {
        const marker = L.marker(target, {
          draggable: true,
          icon: manualTargetIcon(),
          keyboard: false,
          autoPan: false,
        });
        if (onManualTargetChange) {
          marker.on("dragend", () => {
            const position = marker.getLatLng();
            onManualTargetChange({ lat: position.lat, lng: position.lng });
          });
        }
        marker.addTo(overlay);
      } else {
        L.circleMarker(target, {
          radius: 4,
          color: "var(--fb-map-analysis-line)",
          weight: 1.1,
          fillColor: "var(--fb-map-analysis-fill)",
          fillOpacity: 0.97,
          opacity: 0.95,
          interactive: false,
        }).addTo(overlay);
      }

      if (photo.location_uncertainty_m != null && Number.isFinite(photo.location_uncertainty_m)) {
        const radius = Math.max(1.4, Math.min(photo.location_uncertainty_m, 50));
        L.circle(target, {
          radius,
          color: "var(--fb-map-analysis-line-soft)",
          fillColor: "var(--fb-map-analysis-line-soft)",
          fillOpacity: 0.2,
          weight: 1,
          opacity: 0.7,
          interactive: false,
        }).addTo(overlay);
      }

      if (photo.analysis_zone?.footprint_polygon?.coordinates) {
        const footprint = toPolygonLatLngs(photo.analysis_zone.footprint_polygon.coordinates);
        if (footprint.length > 3) {
          footprint.forEach((point) => points.push(L.latLng(point[0], point[1])));
          L.polygon(footprint, {
            color: "var(--fb-map-analysis-line)",
            fillColor: "var(--fb-map-analysis-line-soft)",
            fillOpacity: 0.15,
            weight: 1.2,
            opacity: 0.85,
            dashArray: "3 7",
            interactive: false,
          }).addTo(overlay);
        }
      }

      if (photo.analysis_zone?.sample_points?.length) {
        photo.analysis_zone.sample_points.forEach((samplePoint) => {
          const sample = toLatLngFromPoint(samplePoint);
          if (!sample) return;
          points.push(L.latLng(sample[0], sample[1]));
          L.circleMarker(L.latLng(sample[0], sample[1]), {
            radius: 2.2,
            color: "var(--fb-map-analysis-accent)",
            fillColor: "var(--fb-map-analysis-line)",
            fillOpacity: 0.94,
            weight: 0.9,
            opacity: 0.9,
            interactive: false,
          }).addTo(overlay);
        });
      }
    } else if (photo.heading_deg != null && Number.isFinite(photo.heading_deg)) {
      const headingPoint = projectByHeading(source, photo.heading_deg, 26);
      points.push(headingPoint);

      L.polyline([source, headingPoint], {
        color: "var(--fb-map-analysis-line)",
        weight: 2,
        opacity: 0.9,
        dashArray: "3 6",
        lineCap: "round",
        interactive: false,
      }).addTo(overlay);
    }

    if (points.length <= 0) {
      mapRef.current.fitBounds(L.latLngBounds([source]), {
        animate: false,
        maxZoom: Math.min(BASE_MAP_STYLES[baseMapStyle].maxZoom, 16),
      });
      return;
    }

    const bounds = L.latLngBounds(points);
    const uncertaintyContextM =
      photo.location_uncertainty_m != null && Number.isFinite(photo.location_uncertainty_m)
        ? photo.location_uncertainty_m * 6
        : 0;
    const samplingContextM =
      photo.analysis_zone?.sampling_strategy?.radius_m != null && Number.isFinite(photo.analysis_zone.sampling_strategy.radius_m)
        ? photo.analysis_zone.sampling_strategy.radius_m * 8
        : 0;
    const contextRadiusM = Math.max(MIN_CONTEXT_RADIUS_M, uncertaintyContextM, samplingContextM);
    const contextBounds = expandBoundsWithContext(bounds, contextRadiusM);

    // Inset ligger i et layout som kan endres når fullskjerm åpnes/lukkes.
    try {
      mapRef.current.invalidateSize(false);
      mapRef.current.fitBounds(contextBounds.pad(0.35), {
        animate: false,
        maxZoom: Math.min(BASE_MAP_STYLES[baseMapStyle].maxZoom, 17),
      });
    } catch {
      mapRef.current.setView(source, 16, { animate: false });
    }
  }, [photo, baseMapStyle, editable, manualTarget, onManualTargetChange]);

  return (
    <div className="photo-viewer-map-inset" aria-hidden="true">
      <div ref={mapElementRef} className="photo-viewer-map-canvas" />
    </div>
  );
}
