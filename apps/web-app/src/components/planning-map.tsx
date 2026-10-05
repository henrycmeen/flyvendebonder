import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";

import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import type { FlightMission, FlightMissionPreview, GeoJSONPolygon, GeoPoint, NoGoBuffer, PlanningUnit } from "@/types";

type LatLngPair = [number, number];
type CaptureFrame = {
  sequence: number;
  point: LatLngPair;
  heading_deg: number;
};
type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

interface PlanningMapProps {
  units: PlanningUnit[];
  missions: FlightMission[];
  previewMission: FlightMissionPreview | null;
  previewPending: boolean;
  playbackActive: boolean;
  playbackIndex: number;
  playbackFootprint:
    | {
        width_m: number;
        height_m: number;
      }
    | null;
  previewSuggestion: {
    key: string;
    name: string;
    propertyLabel: string;
    geometry: GeoJSONPolygon;
  } | null;
  suggestionFocusToken: number;
  activeMissionId: number | null;
  missionFocusToken: number;
  selectedUnitId: number | null;
  editMode: boolean;
  resolveOnMapClick: boolean;
  splitMode: boolean;
  launchMode: boolean;
  landingMode: boolean;
  noGoMode: boolean;
  splitPoints: GeoPoint[];
  launchPoint: GeoPoint | null;
  landingPoint: GeoPoint | null;
  noGoBuffers: NoGoBuffer[];
  selectedNoGoBufferId: string | null;
  baseMapStyle: BaseMapStyle;
  showZoomControls: boolean;
  mapGrayscale: boolean;
  mapVintage: boolean;
  onSelectUnit: (unitId: number) => void;
  onResolvePoint: (point: GeoPoint) => void;
  onAddSplitPoint: (point: GeoPoint) => void;
  onSetLaunchPoint: (point: GeoPoint) => void;
  onSetLandingPoint: (point: GeoPoint) => void;
  onAddNoGoBuffer: (point: GeoPoint) => void;
  onSelectNoGoBuffer: (bufferId: string | null) => void;
  onMoveNoGoBuffer: (bufferId: string | null, point: GeoPoint) => void;
  onResizeNoGoBuffer: (bufferId: string | null, widthM: number, heightM: number) => void;
  onUnitGeometryChange: (geometry: GeoJSONPolygon) => void;
}

function resetLeafletContainer(container: LeafletContainer): void {
  container._leaflet_id = undefined;
  container.innerHTML = "";
}

function toPolygonLatLngs(raw: number[][][] | null | undefined): LatLngPair[] {
  if (!raw || raw.length === 0 || !Array.isArray(raw[0])) return [];
  return raw[0].flatMap((point) => {
    if (!Array.isArray(point) || point.length < 2) return [];
    const lng = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [[lat, lng] as LatLngPair];
  });
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

function polygonLabel(name: string, selected = false): L.DivIcon {
  return L.divIcon({
    className: selected ? "fb-field-label-shell fb-field-label-shell--selected" : "fb-field-label-shell",
    html: `<span class="${selected ? "fb-field-label fb-field-label--selected" : "fb-field-label"}">${name}</span>`,
  });
}

function metersPerDegreeLat(): number {
  return 111_320;
}

function metersPerDegreeLng(lat: number): number {
  return Math.max(1e-6, Math.cos((lat * Math.PI) / 180) * 111_320);
}

function noGoBufferCorners(buffer: NoGoBuffer): LatLngPair[] {
  const halfWidth = Number(buffer.width_m ?? ((buffer.radius_m ?? 15) * 2)) / 2;
  const halfHeight = Number(buffer.height_m ?? ((buffer.radius_m ?? 15) * 2)) / 2;
  const metersLat = metersPerDegreeLat();
  const metersLng = metersPerDegreeLng(buffer.center.lat);
  const latOffset = halfHeight / metersLat;
  const lngOffset = halfWidth / metersLng;
  return [
    [buffer.center.lat - latOffset, buffer.center.lng - lngOffset],
    [buffer.center.lat - latOffset, buffer.center.lng + lngOffset],
    [buffer.center.lat + latOffset, buffer.center.lng + lngOffset],
    [buffer.center.lat + latOffset, buffer.center.lng - lngOffset],
  ];
}

function noGoCornerHandleIcon(): L.DivIcon {
  return L.divIcon({
    className: "fb-field-handle-shell",
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: '<span class="fb-field-handle fb-field-handle--danger"></span>',
  });
}

function noGoCenterHandleIcon(): L.DivIcon {
  return L.divIcon({
    className: "fb-field-handle-shell",
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    html: '<span class="fb-field-handle fb-field-handle--danger fb-field-handle--center"></span>',
  });
}

function routeFeatureKind(feature: Record<string, unknown>): string | null {
  const properties = feature.properties;
  if (!properties || typeof properties !== "object") return null;
  const kind = (properties as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

function captureFramesFromMission(mission: FlightMission | FlightMissionPreview | null): CaptureFrame[] {
  if (!mission?.route_geojson?.features) return [];
  const rawFrames = mission.route_geojson.features
    .flatMap((feature) => {
      if (!feature || typeof feature !== "object") return [];
      const record = feature as Record<string, unknown>;
      const geometry = record.geometry;
      if (!geometry || typeof geometry !== "object") return [];
      if ((geometry as { type?: unknown }).type !== "Point") return [];
      if (routeFeatureKind(record) !== "waypoint") return [];
      const point = toLineLatLngs([((geometry as { coordinates?: unknown }).coordinates)]);
      if (!point[0]) return [];
      const properties = record.properties;
      const sequence = Number((properties as { sequence?: unknown } | undefined)?.sequence ?? 0);
      return [{ sequence, point: point[0] }];
    })
    .sort((a, b) => a.sequence - b.sequence);

  return rawFrames.map((frame, index) => {
    const current = frame.point;
    const next = rawFrames[index + 1]?.point ?? rawFrames[index - 1]?.point ?? current;
    const dxMeters = (next[1] - current[1]) * metersPerDegreeLng(current[0]);
    const dyMeters = (next[0] - current[0]) * metersPerDegreeLat();
    const headingDeg = Math.atan2(dxMeters, dyMeters) * (180 / Math.PI);
    return {
      sequence: frame.sequence,
      point: frame.point,
      heading_deg: Number.isFinite(headingDeg) ? headingDeg : 0,
    };
  });
}

function footprintCorners(point: LatLngPair, widthM: number, heightM: number, headingDeg: number): LatLngPair[] {
  const halfAcross = widthM / 2;
  const halfAlong = heightM / 2;
  const headingRad = (headingDeg * Math.PI) / 180;
  const alongEast = Math.sin(headingRad);
  const alongNorth = Math.cos(headingRad);
  const acrossEast = Math.cos(headingRad);
  const acrossNorth = -Math.sin(headingRad);
  const metersLat = metersPerDegreeLat();
  const metersLng = metersPerDegreeLng(point[0]);

  return ([
    [-halfAcross, -halfAlong],
    [halfAcross, -halfAlong],
    [halfAcross, halfAlong],
    [-halfAcross, halfAlong],
  ] as const).map(([across, along]) => {
    const east = across * acrossEast + along * alongEast;
    const north = across * acrossNorth + along * alongNorth;
    return [point[0] + north / metersLat, point[1] + east / metersLng] as LatLngPair;
  });
}

function previewDroneIcon(): L.DivIcon {
  return L.divIcon({
    className: "fb-playback-drone-shell",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: '<span class="fb-playback-drone"></span>',
  });
}

export function PlanningMap({
  units,
  missions,
  previewMission,
  previewPending,
  playbackActive,
  playbackIndex,
  playbackFootprint,
  previewSuggestion,
  suggestionFocusToken,
  activeMissionId,
  missionFocusToken,
  selectedUnitId,
  editMode,
  resolveOnMapClick,
  splitMode,
  launchMode,
  landingMode,
  noGoMode,
  splitPoints,
  launchPoint,
  landingPoint,
  noGoBuffers,
  selectedNoGoBufferId,
  baseMapStyle,
  showZoomControls,
  mapGrayscale,
  mapVintage,
  onSelectUnit,
  onResolvePoint,
  onAddSplitPoint,
  onSetLaunchPoint,
  onSetLandingPoint,
  onAddNoGoBuffer,
  onSelectNoGoBuffer,
  onMoveNoGoBuffer,
  onResizeNoGoBuffer,
  onUnitGeometryChange,
}: PlanningMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const unitLayerRef = useRef<L.LayerGroup | null>(null);
  const missionLayerRef = useRef<L.LayerGroup | null>(null);
  const splitLayerRef = useRef<L.LayerGroup | null>(null);
  const handleLayerRef = useRef<L.LayerGroup | null>(null);
  const suggestionLayerRef = useRef<L.LayerGroup | null>(null);
  const playbackLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFitRef = useRef(false);
  const activeMission = useMemo(
    () => missions.find((mission) => mission.id === activeMissionId) ?? null,
    [activeMissionId, missions],
  );
  const displayedMission = previewMission ?? (previewPending ? null : activeMission);
  const mapCursorMode = splitMode
    ? "split"
    : launchMode
      ? "launch"
      : landingMode
        ? "landing"
        : noGoMode
          ? "no-go"
          : resolveOnMapClick
            ? "resolve"
            : editMode
              ? "edit"
              : "select";

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) return;
    resetLeafletContainer(mapElementRef.current as LeafletContainer);
    const map = L.map(mapElementRef.current, {
      zoomControl: false,
      attributionControl: true,
      maxZoom: 21,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120,
    }).setView([59.1708, 9.6607], 13);

    map.createPane("planningPane");
    map.getPane("planningPane")!.style.zIndex = "560";
    map.createPane("planningMissionPane");
    map.getPane("planningMissionPane")!.style.zIndex = "585";
    map.createPane("planningSplitPane");
    map.getPane("planningSplitPane")!.style.zIndex = "620";
    map.createPane("planningHandlePane");
    map.getPane("planningHandlePane")!.style.zIndex = "640";
    map.createPane("planningPlaybackPane");
    map.getPane("planningPlaybackPane")!.style.zIndex = "630";

    unitLayerRef.current = L.layerGroup().addTo(map);
    missionLayerRef.current = L.layerGroup().addTo(map);
    splitLayerRef.current = L.layerGroup().addTo(map);
    handleLayerRef.current = L.layerGroup().addTo(map);
    suggestionLayerRef.current = L.layerGroup().addTo(map);
    playbackLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      unitLayerRef.current = null;
      missionLayerRef.current = null;
      splitLayerRef.current = null;
      handleLayerRef.current = null;
      suggestionLayerRef.current = null;
      playbackLayerRef.current = null;
    };
  }, []);

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
    const map = mapRef.current;
    if (!map || !showZoomControls) return;
    const control = L.control.zoom({ zoomInTitle: "Zoom inn", zoomOutTitle: "Zoom ut" });
    control.addTo(map);
    return () => { control.remove(); };
  }, [showZoomControls]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    const style = BASE_MAP_STYLES[baseMapStyle];
    map.setMaxZoom(style.maxZoom);
    if (!style.tileUrl) return;
    const layerOptions: L.TileLayerOptions = {
      attribution: style.attribution,
      maxZoom: style.maxZoom,
    };
    if (style.subdomains) {
      layerOptions.subdomains = style.subdomains;
    }
    const layer = L.tileLayer(style.tileUrl, layerOptions);
    layer.addTo(map);
    baseLayerRef.current = layer;
  }, [baseMapStyle]);

  useEffect(() => {
    const tilePane = mapRef.current?.getPane("tilePane");
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
    const map = mapRef.current;
    if (!map) return;
    const handleClick = (event: L.LeafletMouseEvent) => {
      const point = { lat: event.latlng.lat, lng: event.latlng.lng };
      if (splitMode) {
        onAddSplitPoint(point);
        return;
      }
      if (launchMode) {
        onSetLaunchPoint(point);
        return;
      }
      if (landingMode) {
        onSetLandingPoint(point);
        return;
      }
      if (noGoMode) {
        onAddNoGoBuffer(point);
        return;
      }
      if (resolveOnMapClick && !editMode) {
        onResolvePoint(point);
      }
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [
    editMode,
    landingMode,
    launchMode,
    noGoMode,
    onAddNoGoBuffer,
    onAddSplitPoint,
    onResolvePoint,
    onSetLandingPoint,
    onSetLaunchPoint,
    resolveOnMapClick,
    splitMode,
  ]);

  useEffect(() => {
    const layer = missionLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!displayedMission) return;

    displayedMission.fields.forEach((field) => {
      const latLngs = toPolygonLatLngs(field.geometry.coordinates);
      if (latLngs.length < 4) return;

      const polygon = L.polygon(latLngs, {
        color: "rgba(58, 109, 214, 0.96)",
        fillColor: "rgba(91, 140, 246, 0.16)",
        fillOpacity: 0.16,
        weight: 2.2,
        opacity: 0.95,
        pane: "planningMissionPane",
        interactive: false,
      });
      polygon.bindTooltip(`Oppdrag · ${field.name}`, { sticky: true });
      layer.addLayer(polygon);
    });

    displayedMission.route_geojson.features.forEach((feature) => {
      if (!feature || typeof feature !== "object") return;
      const geometry = (feature as { geometry?: unknown }).geometry;
      if (!geometry || typeof geometry !== "object") return;

      const geometryType = (geometry as { type?: unknown }).type;
      if (geometryType === "LineString") {
        const latLngs = toLineLatLngs((geometry as { coordinates?: unknown }).coordinates);
        if (latLngs.length < 2) return;
        layer.addLayer(
          L.polyline(latLngs, {
            color: "#5b8cf6",
            weight: 2.8,
            opacity: 0.96,
            lineCap: "round",
            pane: "planningMissionPane",
            interactive: false,
          }),
        );
        return;
      }

      if (geometryType === "Point") {
        const latLngs = toLineLatLngs([(geometry as { coordinates?: unknown }).coordinates]);
        const point = latLngs[0];
        if (!point) return;
        layer.addLayer(
          L.circleMarker(point, {
            radius: 3.8,
            color: "#f4f8ff",
            weight: 1.4,
            fillColor: "#5b8cf6",
            fillOpacity: 0.95,
            pane: "planningMissionPane",
            interactive: false,
          }),
        );
      }
    });
  }, [displayedMission]);

  useEffect(() => {
    const layer = playbackLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!playbackActive || !displayedMission || !playbackFootprint) return;

    const frames = captureFramesFromMission(displayedMission);
    if (frames.length === 0) return;
    const safeIndex = Math.max(0, Math.min(playbackIndex, frames.length - 1));

    frames.forEach((frame, index) => {
      const corners = footprintCorners(
        frame.point,
        playbackFootprint.width_m,
        playbackFootprint.height_m,
        frame.heading_deg,
      );
      const isActive = index === safeIndex;
      layer.addLayer(
        L.polygon(corners, {
          color: isActive ? "rgba(16, 185, 129, 0.92)" : "rgba(37, 99, 235, 0.18)",
          weight: isActive ? 1.8 : 1.2,
          opacity: isActive ? 0.94 : 0.4,
          fillColor: isActive ? "rgba(16, 185, 129, 0.22)" : "rgba(96, 165, 250, 0.04)",
          fillOpacity: isActive ? 0.22 : 0.04,
          dashArray: isActive ? "5 4" : "3 6",
          pane: "planningPlaybackPane",
          interactive: false,
        }),
      );
    });

    const activeFrame = frames[safeIndex];
    layer.addLayer(
      L.circleMarker(activeFrame.point, {
        radius: 6,
        color: "#f4f8ff",
        weight: 2,
        fillColor: "#10b981",
        fillOpacity: 0.98,
        pane: "planningPlaybackPane",
        interactive: false,
      }).bindTooltip(`Bildepunkt ${safeIndex + 1}/${frames.length}`, { sticky: true }),
    );
    layer.addLayer(
      L.marker(activeFrame.point, {
        icon: previewDroneIcon(),
        pane: "planningPlaybackPane",
        interactive: false,
        keyboard: false,
      }),
    );
  }, [displayedMission, playbackActive, playbackFootprint, playbackIndex]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = suggestionLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    if (!previewSuggestion) return;

    const latLngs = toPolygonLatLngs(previewSuggestion.geometry?.coordinates);
    if (latLngs.length < 4) return;

    const polygon = L.polygon(latLngs, {
      color: "rgba(58, 109, 214, 0.96)",
      fillColor: "rgba(91, 140, 246, 0.14)",
      fillOpacity: 0.14,
      weight: 2.2,
      opacity: 0.96,
      dashArray: "8 6",
      pane: "planningPane",
      interactive: false,
    });
    polygon.bindTooltip(`${previewSuggestion.name} · forhåndsvisning`, { sticky: true });
    layer.addLayer(polygon);

    const bounds = polygon.getBounds();
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [48, 48], maxZoom: 18 });
    }
  }, [previewSuggestion, suggestionFocusToken]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = unitLayerRef.current;
    const handleLayer = handleLayerRef.current;
    if (!map || !layer || !handleLayer) return;
    layer.clearLayers();
    handleLayer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];
    units.forEach((unit) => {
      const latLngs = toPolygonLatLngs(unit.geometry?.coordinates);
      if (latLngs.length < 4) return;
      const isSelected = unit.id === selectedUnitId;
      const polygon = L.polygon(latLngs, {
        color: isSelected ? "rgba(37, 99, 235, 0.98)" : "rgba(191, 126, 63, 0.9)",
        fillColor: isSelected ? "rgba(96, 165, 250, 0.18)" : "rgba(244, 199, 112, 0.18)",
        fillOpacity: isSelected ? 0.24 : 0.18,
        weight: isSelected ? 3.2 : 1.8,
        opacity: 0.96,
        pane: "planningPane",
        bubblingMouseEvents: false,
        className: isSelected ? "fb-planning-unit fb-planning-unit--selected" : "fb-planning-unit",
      });
      polygon.on("click", () => {
        onSelectUnit(unit.id);
      });
      polygon.bindTooltip(unit.name, { sticky: true });
      layer.addLayer(polygon);
      boundsPoints.push(...latLngs);

      const bounds = polygon.getBounds();
      const center = bounds.isValid() ? bounds.getCenter() : null;
      if (center) {
        layer.addLayer(
          L.marker(center, {
            pane: "planningPane",
            interactive: false,
            keyboard: false,
            icon: polygonLabel(isSelected ? `${unit.name} · valgt` : unit.name, isSelected),
          }),
        );
      }

      if (isSelected && editMode) {
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
            pane: "planningHandlePane",
            keyboard: false,
            zIndexOffset: 700,
          });
          handleMarker.on("drag", () => {
            const nextPoint = handleMarker.getLatLng();
            const nextPoints: LatLngPair[] = editablePoints.map(([lat, lng], pointIndex) =>
              pointIndex === index ? ([nextPoint.lat, nextPoint.lng] as LatLngPair) : [lat, lng],
            );
            polygon.setLatLngs(nextPoints as L.LatLngExpression[]);
          });
          handleMarker.on("dragend", () => {
            const nextPoint = handleMarker.getLatLng();
            const nextPoints: LatLngPair[] = editablePoints.map(([lat, lng], pointIndex) =>
              pointIndex === index ? ([nextPoint.lat, nextPoint.lng] as LatLngPair) : [lat, lng],
            );
            onUnitGeometryChange({
              type: "Polygon",
              coordinates: toPolygonCoordinates(nextPoints),
            });
          });
          handleLayer.addLayer(handleMarker);
        });
      }
    });

    if (displayedMission && selectedUnitId == null) {
      const missionBoundsPoints: L.LatLngExpression[] = [];
      displayedMission.fields.forEach((field) => {
        missionBoundsPoints.push(...toPolygonLatLngs(field.geometry.coordinates));
      });
      displayedMission.route_geojson.features.forEach((feature) => {
        if (!feature || typeof feature !== "object") return;
        const geometry = (feature as { geometry?: unknown }).geometry;
        if (!geometry || typeof geometry !== "object") return;
        const geometryType = (geometry as { type?: unknown }).type;
        if (geometryType === "LineString") {
          missionBoundsPoints.push(...toLineLatLngs((geometry as { coordinates?: unknown }).coordinates));
        } else if (geometryType === "Point") {
          missionBoundsPoints.push(...toLineLatLngs([(geometry as { coordinates?: unknown }).coordinates]));
        }
      });
      if (missionBoundsPoints.length > 0) {
        map.fitBounds(L.latLngBounds(missionBoundsPoints), { padding: [48, 48], maxZoom: 18 });
        hasFitRef.current = true;
        return;
      }
    }

    if (boundsPoints.length > 0 && (!hasFitRef.current || selectedUnitId == null)) {
      map.fitBounds(L.latLngBounds(boundsPoints), { padding: [32, 32], maxZoom: 17 });
      hasFitRef.current = true;
    } else if (selectedUnitId != null) {
      const selected = units.find((item) => item.id === selectedUnitId);
      if (selected) {
        const latLngs = toPolygonLatLngs(selected.geometry?.coordinates);
        if (latLngs.length > 0) {
          map.fitBounds(L.latLngBounds(latLngs), { padding: [48, 48], maxZoom: 18 });
        }
      }
    }
  }, [displayedMission, editMode, missionFocusToken, onSelectUnit, onUnitGeometryChange, selectedUnitId, units]);

  useEffect(() => {
    const layer = splitLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    noGoBuffers.forEach((buffer) => {
      const corners = noGoBufferCorners(buffer);
      const rectangle = L.polygon(corners, {
        color: buffer.id === selectedNoGoBufferId ? "#b42318" : "#c2410c",
        weight: buffer.id === selectedNoGoBufferId ? 2.4 : 1.8,
        opacity: 0.94,
        fillColor: "rgba(217, 45, 32, 0.12)",
        fillOpacity: 0.18,
        dashArray: "6 5",
        pane: "planningSplitPane",
        bubblingMouseEvents: false,
      });
      rectangle.on("click", () => {
        onSelectNoGoBuffer(buffer.id);
      });
      rectangle.bindTooltip(buffer.name || "Hinder", { sticky: true });
      layer.addLayer(rectangle);

      if (buffer.id === selectedNoGoBufferId) {
        const centerMarker = L.marker([buffer.center.lat, buffer.center.lng], {
          draggable: true,
          icon: noGoCenterHandleIcon(),
          pane: "planningHandlePane",
          keyboard: false,
          zIndexOffset: 750,
        });
        centerMarker.on("dragend", () => {
          const nextPoint = centerMarker.getLatLng();
          onMoveNoGoBuffer(buffer.id, { lat: nextPoint.lat, lng: nextPoint.lng });
        });
        layer.addLayer(centerMarker);

        corners.forEach(([lat, lng]) => {
          const cornerMarker = L.marker([lat, lng], {
            draggable: true,
            icon: noGoCornerHandleIcon(),
            pane: "planningHandlePane",
            keyboard: false,
            zIndexOffset: 760,
          });
          cornerMarker.on("drag", () => {
            const nextPoint = cornerMarker.getLatLng();
            const dxMeters = Math.abs((nextPoint.lng - buffer.center.lng) * metersPerDegreeLng(buffer.center.lat));
            const dyMeters = Math.abs((nextPoint.lat - buffer.center.lat) * metersPerDegreeLat());
            const widthM = Math.max(6, Math.round(dxMeters * 2));
            const heightM = Math.max(6, Math.round(dyMeters * 2));
            const nextCorners = noGoBufferCorners({ ...buffer, width_m: widthM, height_m: heightM });
            rectangle.setLatLngs(nextCorners as L.LatLngExpression[]);
          });
          cornerMarker.on("dragend", () => {
            const nextPoint = cornerMarker.getLatLng();
            const dxMeters = Math.abs((nextPoint.lng - buffer.center.lng) * metersPerDegreeLng(buffer.center.lat));
            const dyMeters = Math.abs((nextPoint.lat - buffer.center.lat) * metersPerDegreeLat());
            onResizeNoGoBuffer(buffer.id, Math.max(6, Math.round(dxMeters * 2)), Math.max(6, Math.round(dyMeters * 2)));
          });
          layer.addLayer(cornerMarker);
        });
      }
    });

    if (launchPoint) {
      layer.addLayer(
        L.circleMarker([launchPoint.lat, launchPoint.lng], {
          radius: 6,
          color: "#f4f8ff",
          weight: 2,
          fillColor: "#16a34a",
          fillOpacity: 0.98,
          pane: "planningSplitPane",
        }).bindTooltip("Startpunkt", { sticky: true }),
      );
    }

    if (landingPoint) {
      layer.addLayer(
        L.circleMarker([landingPoint.lat, landingPoint.lng], {
          radius: 6,
          color: "#f4f8ff",
          weight: 2,
          fillColor: "#2563eb",
          fillOpacity: 0.98,
          pane: "planningSplitPane",
        }).bindTooltip("Landingspunkt", { sticky: true }),
      );
    }

    if (!splitMode) return;

    splitPoints.forEach((point, index) => {
      layer.addLayer(
        L.circleMarker([point.lat, point.lng], {
          radius: index === 0 ? 6 : 7,
          color: "#f4f8ff",
          weight: 2,
          fillColor: "#c75c24",
          fillOpacity: 0.98,
          pane: "planningSplitPane",
        }),
      );
    });

    if (splitPoints.length >= 2) {
      layer.addLayer(
        L.polyline(
          splitPoints.map((point) => [point.lat, point.lng] as L.LatLngExpression),
          {
            color: "#c75c24",
            weight: 3,
            opacity: 0.96,
            dashArray: "7 8",
            pane: "planningSplitPane",
          },
        ),
      );
    }
  }, [
    landingPoint,
    launchPoint,
    noGoBuffers,
    onMoveNoGoBuffer,
    onResizeNoGoBuffer,
    onSelectNoGoBuffer,
    selectedNoGoBufferId,
    splitMode,
    splitPoints,
  ]);

  return (
    <div
      ref={mapElementRef}
      data-map-mode={mapCursorMode}
      className="fb-planning-map h-full min-h-[22rem] w-full rounded-[28px]"
    />
  );
}
