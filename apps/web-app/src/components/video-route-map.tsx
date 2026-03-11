import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";

import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import type { VideoMapPlacement } from "@/types";

type LatLngPair = [number, number];
type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toLatLngPair(value: unknown): LatLngPair | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lat = value[1];
  const lng = value[0];
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) return null;
  return [lat, lng];
}

function collectLatLngPairs(raw: unknown): LatLngPair[] {
  const out: LatLngPair[] = [];
  const walk = (node: unknown): void => {
    if (!Array.isArray(node)) return;

    if (node.length >= 2 && isFiniteNumber(node[0]) && isFiniteNumber(node[1])) {
      const point = toLatLngPair(node);
      if (point) out.push(point);
      return;
    }

    if (node.every((child) => Array.isArray(child))) {
      for (const child of node) {
        walk(child);
      }
    }
  };

  walk(raw);
  return out;
}

function extractSegments(raw: unknown): LatLngPair[][] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const record = raw as Record<string, unknown>;
  if (typeof record.type === "string" && record.type.toLowerCase() === "featurecollection" && Array.isArray(record.features)) {
    return (record.features as unknown[])
      .map((feature) => collectLatLngPairs((feature as Record<string, unknown> | null)?.geometry))
      .filter((segment) => segment.length > 0);
  }

  const geometry = record.geometry;
  if (geometry && typeof geometry === "object" && !Array.isArray(geometry)) {
    const segment = collectLatLngPairs((geometry as Record<string, unknown>).coordinates);
    return segment.length > 0 ? [segment] : [];
  }

  const coordinates = record.coordinates;
  if (coordinates) {
    const segment = collectLatLngPairs(coordinates);
    return segment.length > 0 ? [segment] : [];
  }

  return [];
}

function resetLeafletContainer(container: LeafletContainer): void {
  container._leaflet_id = undefined;
  container.innerHTML = "";
}

function shiftSegments(
  segments: LatLngPair[][],
  from: LatLngPair,
  to: LatLngPair,
): LatLngPair[][] {
  const latDelta = to[0] - from[0];
  const lngDelta = to[1] - from[1];
  return segments.map((segment) => segment.map(([lat, lng]) => [lat + latDelta, lng + lngDelta]));
}

function interpolatePoint(from: LatLngPair, to: LatLngPair, ratio: number): LatLngPair {
  return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
}

function flattenSegments(segments: LatLngPair[][]): LatLngPair[] {
  const points: LatLngPair[] = [];
  segments.forEach((segment, segmentIndex) => {
    segment.forEach((point, pointIndex) => {
      if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
      if (segmentIndex > 0 && pointIndex === 0 && points.length > 0) {
        const previous = points[points.length - 1];
        if (previous[0] === point[0] && previous[1] === point[1]) return;
      }
      points.push(point);
    });
  });
  return points;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pointAlongRoute(
  route: LatLngPair[],
  progress: number,
): { point: LatLngPair; endIndex: number; ratio: number } {
  if (route.length === 0) {
    return { point: [0, 0], endIndex: 0, ratio: 0 };
  }
  if (route.length === 1) {
    return { point: route[0], endIndex: 0, ratio: 0 };
  }

  const normalized = clamp(progress, 0, 100) / 100;
  const scaled = normalized * (route.length - 1);
  const endIndex = Math.min(Math.floor(scaled), route.length - 2);
  const nextIndex = endIndex + 1;
  const ratio = scaled - endIndex;

  return {
    point: interpolatePoint(route[endIndex], route[nextIndex], ratio),
    endIndex,
    ratio,
  };
}

function firstSegmentPoint(segments: LatLngPair[][]): LatLngPair | null {
  for (const segment of segments) {
    if (segment.length > 0) {
      return segment[0];
    }
  }
  return null;
}

function placementHandleIcon(): L.DivIcon {
  return L.divIcon({
    className: "photo-viewer-map-target-handle-shell",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: '<span class="photo-viewer-map-target-handle"></span>',
  });
}

interface VideoRouteMapProps {
  geodataUrl: string;
  baseMapStyle: BaseMapStyle;
  showZoomControls: boolean;
  editable?: boolean;
  placement?: VideoMapPlacement | null;
  onPlacementChange?: (placement: VideoMapPlacement | null) => void;
  onRouteStatsChange?: (stats: {
    segmentCount: number;
    pointCount: number;
    startPoint: [number, number] | null;
    endPoint: [number, number] | null;
  } | null) => void;
}

export function VideoRouteMap({
  geodataUrl,
  baseMapStyle,
  showZoomControls,
  editable = false,
  placement,
  onPlacementChange,
  onRouteStatsChange,
}: VideoRouteMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const routeLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);
  const markerRef = useRef<L.Layer | null>(null);
  const animationMarkerRef = useRef<L.CircleMarker | null>(null);
  const animationTimerRef = useRef<number | null>(null);
  const progressLineRef = useRef<L.Polyline | null>(null);
  const hasAutoFitRef = useRef(false);
  const routePointsRef = useRef<LatLngPair[]>([]);
  const routeScrubProgressRef = useRef(0);

  const [segments, setSegments] = useState<LatLngPair[][]>([]);
  const [routeLoaded, setRouteLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeScrubProgress, setRouteScrubProgress] = useState(0);

  const clearProgressVisual = useCallback(() => {
    if (progressLineRef.current && routeLayerRef.current) {
      routeLayerRef.current.removeLayer(progressLineRef.current);
    }
    progressLineRef.current = null;

    if (animationMarkerRef.current && markerLayerRef.current) {
      markerLayerRef.current.removeLayer(animationMarkerRef.current);
    }
    animationMarkerRef.current = null;
  }, []);

  const clearAnimation = useCallback(() => {
    if (animationTimerRef.current !== null) {
      window.clearInterval(animationTimerRef.current);
      animationTimerRef.current = null;
    }
  }, []);

  const applyScrubProgress = useCallback((routePoints: LatLngPair[], progress: number) => {
    if (!markerLayerRef.current || !routeLayerRef.current) return;
    if (routePoints.length < 2) {
      clearProgressVisual();
      return;
    }

    const clamped = clamp(progress, 0, 100);
    const { point, endIndex, ratio } = pointAlongRoute(routePoints, clamped);
    const visiblePart = routePoints.slice(0, endIndex + 1);
    const nextPoint = interpolatePoint(routePoints[endIndex], routePoints[endIndex + 1]!, ratio);
    visiblePart.push(nextPoint);

    if (progressLineRef.current) {
      routeLayerRef.current.removeLayer(progressLineRef.current);
    }
    progressLineRef.current = L.polyline(visiblePart, {
      color: "var(--fb-map-analysis-line)",
      weight: 4.2,
      opacity: 1,
      lineCap: "round",
    });
    progressLineRef.current.addTo(routeLayerRef.current);

    if (!animationMarkerRef.current) {
      animationMarkerRef.current = L.circleMarker(point, {
        radius: 7,
        color: "var(--fb-map-analysis-line)",
        fillColor: "var(--fb-map-analysis-line-soft)",
        fillOpacity: 1,
        weight: 2,
      });
      animationMarkerRef.current.addTo(markerLayerRef.current);
    } else {
      animationMarkerRef.current.setLatLng(point);
    }

    routeScrubProgressRef.current = clamped;
    setRouteScrubProgress(clamped);
  }, [clearProgressVisual]);

  const runRouteSweep = useCallback((routePoints: LatLngPair[]) => {
    if (!routePoints.length) return;
    clearAnimation();
    clearProgressVisual();

    const startProgress = routeScrubProgressRef.current >= 100 ? 0 : routeScrubProgressRef.current;
    const totalSteps = Math.max(35, Math.round(routePoints.length * 10));
    const stepSize = (100 - startProgress) / totalSteps;
    let step = 0;

    const tick = () => {
      const nextProgress = clamp(startProgress + step * stepSize, 0, 100);
      applyScrubProgress(routePoints, nextProgress);
      step += 1;
      if (nextProgress >= 100 || step > totalSteps) {
        clearAnimation();
      }
    };

    tick();
    animationTimerRef.current = window.setInterval(tick, 18);
  }, [applyScrubProgress, clearAnimation, clearProgressVisual]);

  const setRouteScrub = useCallback((rawValue: number, routePoints?: LatLngPair[]) => {
    const clamped = clamp(rawValue, 0, 100);
    routeScrubProgressRef.current = clamped;
    clearAnimation();
    if (!routePoints && routePointsRef.current.length >= 2) {
      applyScrubProgress(routePointsRef.current, clamped);
      return;
    }
    if (routePoints && routePoints.length >= 2) {
      applyScrubProgress(routePoints, clamped);
      return;
    }
    clearProgressVisual();
    setRouteScrubProgress(clamped);
  }, [applyScrubProgress, clearAnimation, clearProgressVisual]);

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) return;
    const container = mapElementRef.current;

    try {
      resetLeafletContainer(container);
    } catch {
      /* no-op */
    }

    const map = L.map(container, {
      zoomControl: showZoomControls,
      attributionControl: false,
      dragging: true,
      scrollWheelZoom: true,
      doubleClickZoom: true,
      boxZoom: true,
      keyboard: true,
      touchZoom: true,
      preferCanvas: true,
      zoomSnap: 0.25,
    });

    mapRef.current = map;
    routeLayerRef.current = L.layerGroup().addTo(map);
    markerLayerRef.current = L.layerGroup().addTo(map);

    return () => {
      try {
        if (animationTimerRef.current !== null) {
          window.clearInterval(animationTimerRef.current);
          animationTimerRef.current = null;
        }
        if (progressLineRef.current && routeLayerRef.current) {
          routeLayerRef.current.removeLayer(progressLineRef.current);
        }
        progressLineRef.current = null;
        if (animationMarkerRef.current && markerLayerRef.current) {
          markerLayerRef.current.removeLayer(animationMarkerRef.current);
        }
        animationMarkerRef.current = null;
        map.remove();
      } catch {
        /* no-op */
      } finally {
        const containerElement = map.getContainer() as LeafletContainer | null;
        if (containerElement) containerElement._leaflet_id = undefined;
      }
      mapRef.current = null;
      baseLayerRef.current = null;
      routeLayerRef.current = null;
      markerLayerRef.current = null;
      markerRef.current = null;
    };
  }, [showZoomControls]);

  useEffect(() => {
    const map = mapRef.current as (L.Map & { zoomControl?: L.Control.Zoom }) | null;
    if (!map?.zoomControl) return;
    if (showZoomControls) {
      map.zoomControl.addTo(map);
    } else {
      map.zoomControl.remove();
    }
  }, [showZoomControls]);

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

    if (!baseLayerRef.current) {
      mapRef.current.eachLayer((layer) => {
        if ((layer as L.TileLayer).getContainer) {
          mapRef.current?.removeLayer(layer);
        }
      });
    }

    if (baseLayerRef.current) {
      mapRef.current.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    const style = BASE_MAP_STYLES[baseMapStyle];
    if (!style.tileUrl) return;

    const tileLayer = L.tileLayer(style.tileUrl, {
      maxZoom: style.maxZoom,
      attribution: style.attribution,
      subdomains: style.subdomains,
    });
    tileLayer.addTo(mapRef.current);
    baseLayerRef.current = tileLayer;
  }, [baseMapStyle]);

  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current || !markerLayerRef.current || !geodataUrl) return;

    const controller = new AbortController();
    let cancelled = false;

    const loadGeodata = async () => {
      try {
        setError(null);
        setRouteLoaded(false);

        const response = await fetch(geodataUrl, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`Kunne ikke hente geodata (${response.status})`);
        }

        const payload = await response.json();
        if (cancelled || !mapRef.current || !routeLayerRef.current || !markerLayerRef.current) return;

        const nextSegments = extractSegments(payload);
        hasAutoFitRef.current = false;
        routeScrubProgressRef.current = 0;
        setRouteScrubProgress(0);
        setSegments(nextSegments);
      } catch (nextError) {
        if (cancelled || (nextError instanceof DOMException && nextError.name === "AbortError")) {
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Kunne ikke laste rutedata.");
        setSegments([]);
      } finally {
        if (!cancelled) {
          setRouteLoaded(true);
        }
      }
    };

    void loadGeodata();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [geodataUrl]);

  useEffect(() => {
    if (onRouteStatsChange) {
      if (segments.length === 0) {
        onRouteStatsChange(null);
      } else {
        const firstSegment = segments.find((segment) => segment.length > 0) ?? [];
        const startPoint = firstSegment.length > 0 ? firstSegment[0] : null;
        const lastSegment = [...segments].reverse().find((segment) => segment.length > 0) ?? [];
        const endPoint = lastSegment.length > 0 ? lastSegment[lastSegment.length - 1] : null;
        const pointCount = segments.reduce((total, segment) => total + segment.length, 0);
        onRouteStatsChange({
          segmentCount: segments.length,
          pointCount,
          startPoint,
          endPoint,
        });
      }
    }
  }, [segments, onRouteStatsChange]);

  useEffect(() => {
    if (!mapRef.current || !routeLayerRef.current || !markerLayerRef.current) return;
    const routeLayer = routeLayerRef.current;
    const markerLayer = markerLayerRef.current;
    const map = mapRef.current;

    routeLayer.clearLayers();
    markerLayer.clearLayers();
    clearAnimation();
    clearProgressVisual();

    const hasSegments = segments.length > 0;
    if (!hasSegments) {
      return;
    }

    const originalStart = firstSegmentPoint(segments);
    if (!originalStart) return;

    const activePlacement = placement ? ([placement.lat, placement.lng] as LatLngPair) : originalStart;

    const drawRoute = (routePlacement: LatLngPair): L.LatLngBounds => {
      routeLayer.clearLayers();
      clearAnimation();
      clearProgressVisual();

      const visibleSegments = shiftSegments(segments, originalStart, routePlacement);
      const flattenedRoutePoints = flattenSegments(visibleSegments);
      routePointsRef.current = flattenedRoutePoints;

      const startStyle = { color: "var(--fb-map-analysis-line)", weight: 2.8, opacity: 0.92, dashArray: "4 8" };
      const hoverStyle = { color: "var(--fb-map-analysis-line)", weight: 4, opacity: 1, dashArray: "8 8" };

      const routeBounds = L.latLngBounds([]);
      visibleSegments.forEach((segment) => {
        const line = L.polyline(segment, startStyle);

        if (segment.length >= 2 && flattenedRoutePoints.length >= 2) {
          line.on("mouseover", () => {
            line.setStyle(hoverStyle);
            runRouteSweep(flattenedRoutePoints);
          });
          line.on("mouseout", () => {
            line.setStyle(startStyle);
            clearAnimation();
            clearProgressVisual();
            routeScrubProgressRef.current = 0;
            setRouteScrubProgress(0);
          });
          line.on("click", () => {
            runRouteSweep(flattenedRoutePoints);
          });
        }

        line.addTo(routeLayer);
        segment.forEach((point) => routeBounds.extend(point));
      });

      if (flattenedRoutePoints.length >= 2) {
        setRouteScrub(routeScrubProgressRef.current, flattenedRoutePoints);
      } else {
        clearProgressVisual();
      }

      return routeBounds;
    };

    const routeBounds = drawRoute(activePlacement);

    if (editable && onPlacementChange) {
      const marker = L.marker(activePlacement, {
        draggable: true,
        icon: placementHandleIcon(),
        keyboard: false,
        autoPan: false,
      });

      marker.on("drag", () => {
        const position = marker.getLatLng();
        const draggedPlacement: LatLngPair = [position.lat, position.lng];
        drawRoute(draggedPlacement);
      });

      marker.on("dragend", () => {
        const position = marker.getLatLng();
        onPlacementChange({ lat: position.lat, lng: position.lng });
      });
      marker.bindTooltip("Dra eller klikk for plassering");
      marker.addTo(markerLayer);
      markerRef.current = marker;
    } else {
      const marker = L.circleMarker(activePlacement, {
        radius: 5,
        color: "var(--fb-map-analysis-line)",
        fillColor: "var(--fb-map-analysis-line-soft)",
        fillOpacity: 0.95,
        weight: 1.1,
        opacity: 0.95,
      }).addTo(markerLayer);
      markerRef.current = marker;
    }

    const onMapClick = (event: L.LeafletMouseEvent) => {
      if (!editable || !onPlacementChange) return;
      onPlacementChange({ lat: event.latlng.lat, lng: event.latlng.lng });
    };
    map.on("click", onMapClick);

    if (!hasAutoFitRef.current && routeBounds.isValid()) {
      map.fitBounds(routeBounds.pad(0.25), { animate: false, maxZoom: Math.min(BASE_MAP_STYLES[baseMapStyle].maxZoom, 17) });
      hasAutoFitRef.current = true;
    }

    return () => {
      clearAnimation();
      clearProgressVisual();
      map.off("click", onMapClick);
      markerLayer.clearLayers();
      routeLayer.clearLayers();
      markerRef.current = null;
    };
  }, [baseMapStyle, clearAnimation, clearProgressVisual, editable, geodataUrl, onPlacementChange, onRouteStatsChange, placement, runRouteSweep, segments, setRouteScrub]);

  useEffect(() => {
    if (!placement || !markerRef.current || !segments.length) return;
    if (!(markerRef.current instanceof L.Marker)) return;
    markerRef.current.setLatLng([placement.lat, placement.lng]);
  }, [placement, segments.length]);

  return (
    <div className="space-y-2">
      <div className="photo-viewer-map-inset">
        <div ref={mapElementRef} className="photo-viewer-map-canvas" />
      </div>
      <div className="space-y-1">
        <label htmlFor="video-route-progress" className="text-xs text-fb-text-secondary">
          Løype: {Math.round(routeScrubProgress)} %
        </label>
        <input
          id="video-route-progress"
          type="range"
          min={0}
          max={100}
          step={1}
          value={routeScrubProgress}
          disabled={!segments.length}
          onChange={(event) => {
            if (!Number.isFinite(event.currentTarget.valueAsNumber)) return;
            setRouteScrub(event.currentTarget.valueAsNumber, routePointsRef.current);
          }}
          className="h-2 w-full cursor-pointer accent-[var(--fb-map-analysis-line)] disabled:cursor-not-allowed disabled:opacity-50"
        />
      </div>
      {editable ? (
        <p className="text-xs text-fb-text-secondary">
          Klikk i kartet eller dra target-markøren for å plassere ruten før du lagrer.
        </p>
      ) : null}
      {error ? <p className="text-xs text-fb-text-primary">{error}</p> : null}
      {!error && routeLoaded && segments.length === 0 ? <p className="text-xs text-fb-text-secondary">Ingen rutedata funnet.</p> : null}
    </div>
  );
}
