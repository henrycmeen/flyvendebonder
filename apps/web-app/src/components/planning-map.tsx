import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";

import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import type { FlightMission, GeoJSONPolygon, GeoPoint, NoGoBuffer, PlanningUnit } from "@/types";

type LatLngPair = [number, number];
type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

interface PlanningMapProps {
  units: PlanningUnit[];
  missions: FlightMission[];
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

function polygonLabel(name: string): L.DivIcon {
  return L.divIcon({
    className: "fb-field-label-shell",
    html: `<span class="fb-field-label">${name}</span>`,
  });
}

export function PlanningMap({
  units,
  missions,
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
  const hasFitRef = useRef(false);
  const activeMission = useMemo(
    () => missions.find((mission) => mission.id === activeMissionId) ?? null,
    [activeMissionId, missions],
  );

  useEffect(() => {
    if (mapRef.current || !mapElementRef.current) return;
    resetLeafletContainer(mapElementRef.current as LeafletContainer);
    const map = L.map(mapElementRef.current, {
      zoomControl: showZoomControls,
      attributionControl: true,
      maxZoom: 21,
    }).setView([59.1708, 9.6607], 13);

    map.createPane("planningPane");
    map.getPane("planningPane")!.style.zIndex = "560";
    map.createPane("planningMissionPane");
    map.getPane("planningMissionPane")!.style.zIndex = "585";
    map.createPane("planningSplitPane");
    map.getPane("planningSplitPane")!.style.zIndex = "620";
    map.createPane("planningHandlePane");
    map.getPane("planningHandlePane")!.style.zIndex = "640";

    unitLayerRef.current = L.layerGroup().addTo(map);
    missionLayerRef.current = L.layerGroup().addTo(map);
    splitLayerRef.current = L.layerGroup().addTo(map);
    handleLayerRef.current = L.layerGroup().addTo(map);
    suggestionLayerRef.current = L.layerGroup().addTo(map);
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
    const map = mapRef.current;
    if (!map) return;
    if (baseLayerRef.current) {
      map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }
    const style = BASE_MAP_STYLES[baseMapStyle];
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
    if (!activeMission) return;

    activeMission.fields.forEach((field) => {
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

    activeMission.route_geojson.features.forEach((feature) => {
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
  }, [activeMission]);

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
        color: isSelected ? "rgba(199, 92, 36, 0.98)" : "rgba(191, 126, 63, 0.9)",
        fillColor: isSelected ? "rgba(243, 162, 87, 0.26)" : "rgba(244, 199, 112, 0.18)",
        fillOpacity: isSelected ? 0.28 : 0.18,
        weight: isSelected ? 2.8 : 1.8,
        opacity: 0.96,
        pane: "planningPane",
        bubblingMouseEvents: false,
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
            icon: polygonLabel(unit.name),
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

    if (activeMission) {
      const missionBoundsPoints: L.LatLngExpression[] = [];
      activeMission.fields.forEach((field) => {
        missionBoundsPoints.push(...toPolygonLatLngs(field.geometry.coordinates));
      });
      activeMission.route_geojson.features.forEach((feature) => {
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
  }, [activeMission, editMode, missionFocusToken, onSelectUnit, onUnitGeometryChange, selectedUnitId, units]);

  useEffect(() => {
    const layer = splitLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    noGoBuffers.forEach((buffer) => {
      layer.addLayer(
        L.circle([buffer.center.lat, buffer.center.lng], {
          radius: buffer.radius_m,
          color: "#b42318",
          weight: 2,
          opacity: 0.92,
          fillColor: "rgba(217, 45, 32, 0.12)",
          fillOpacity: 0.16,
          dashArray: "6 5",
          pane: "planningSplitPane",
          interactive: false,
        }),
      );
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
  }, [landingPoint, launchPoint, noGoBuffers, splitMode, splitPoints]);

  return <div ref={mapElementRef} className="h-full min-h-[22rem] w-full rounded-[28px]" />;
}
