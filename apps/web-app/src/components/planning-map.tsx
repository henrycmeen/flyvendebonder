import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";

import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";
import type { FieldPlot, FieldPlotDraft, GeoJSONPolygon, GeoPoint, PlanningUnit } from "@/types";

type LatLngPair = [number, number];
type LeafletContainer = HTMLDivElement & {
  _leaflet_id?: number;
};

interface PlanningMapProps {
  units: PlanningUnit[];
  fieldPlots: FieldPlot[];
  activeFieldDraft: FieldPlotDraft | null;
  selectedUnitId: number | null;
  selectedMissionUnitIds: number[];
  splitMode: boolean;
  splitPoints: GeoPoint[];
  fieldCreateMode: boolean;
  baseMapStyle: BaseMapStyle;
  showZoomControls: boolean;
  mapGrayscale: boolean;
  mapVintage: boolean;
  onRequestFieldCreateAt: (point: GeoPoint) => void;
  onSelectField: (fieldId: number) => void;
  onFieldGeometryChange: (geometry: GeoJSONPolygon) => void;
  onSelectUnit: (unitId: number) => void;
  onAddSplitPoint: (point: GeoPoint) => void;
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
  fieldPlots,
  activeFieldDraft,
  selectedUnitId,
  selectedMissionUnitIds,
  splitMode,
  splitPoints,
  fieldCreateMode,
  baseMapStyle,
  showZoomControls,
  mapGrayscale,
  mapVintage,
  onRequestFieldCreateAt,
  onSelectField,
  onFieldGeometryChange,
  onSelectUnit,
  onAddSplitPoint,
}: PlanningMapProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const fieldLayerRef = useRef<L.LayerGroup | null>(null);
  const fieldHandleLayerRef = useRef<L.LayerGroup | null>(null);
  const unitLayerRef = useRef<L.LayerGroup | null>(null);
  const splitLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFitRef = useRef(false);
  const selectedMissionUnitIdsSet = useMemo(() => new Set(selectedMissionUnitIds), [selectedMissionUnitIds]);

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
    map.createPane("fieldPane");
    map.getPane("fieldPane")!.style.zIndex = "585";
    map.createPane("fieldHandlePane");
    map.getPane("fieldHandlePane")!.style.zIndex = "610";
    map.createPane("planningSplitPane");
    map.getPane("planningSplitPane")!.style.zIndex = "620";

    fieldLayerRef.current = L.layerGroup().addTo(map);
    fieldHandleLayerRef.current = L.layerGroup().addTo(map);
    unitLayerRef.current = L.layerGroup().addTo(map);
    splitLayerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      baseLayerRef.current = null;
      fieldLayerRef.current = null;
      fieldHandleLayerRef.current = null;
      unitLayerRef.current = null;
      splitLayerRef.current = null;
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
    const handleClick = (event: L.LeafletMouseEvent) => {
      if (fieldCreateMode) {
        onRequestFieldCreateAt({ lat: event.latlng.lat, lng: event.latlng.lng });
        return;
      }
      if (!splitMode) return;
      onAddSplitPoint({ lat: event.latlng.lat, lng: event.latlng.lng });
    };
    map.on("click", handleClick);
    return () => {
      map.off("click", handleClick);
    };
  }, [fieldCreateMode, onAddSplitPoint, onRequestFieldCreateAt, splitMode]);

  useEffect(() => {
    const map = mapRef.current;
    const fieldLayer = fieldLayerRef.current;
    const fieldHandleLayer = fieldHandleLayerRef.current;
    if (!map || !fieldLayer || !fieldHandleLayer) return;

    fieldLayer.clearLayers();
    fieldHandleLayer.clearLayers();
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
      polygon.bindTooltip(field.name ?? `Jord ${field.id}`);
      polygon.on("click", () => {
        onSelectField(field.id);
      });
      fieldLayer.addLayer(polygon);

      const bounds = polygon.getBounds();
      const center = bounds.isValid() ? bounds.getCenter() : null;
      if (center) {
        fieldLayer.addLayer(
          L.marker(center, {
            pane: "fieldPane",
            interactive: false,
            keyboard: false,
            icon: polygonLabel(field.name ?? `Jord ${field.id}`),
          }),
        );
      }
    });

    if (!activeFieldDraft) return;

    const latLngs = toPolygonLatLngs(activeFieldDraft.geometry.coordinates);
    if (latLngs.length < 4) return;

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
    activePolygon.bindTooltip(activeFieldDraft.name?.trim() || "Aktivt jordutkast", {
      permanent: true,
      direction: "center",
      className: "fb-field-active-tooltip",
    });
    fieldLayer.addLayer(activePolygon);

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
      fieldHandleLayer.addLayer(handleMarker);
    });
  }, [activeFieldDraft, fieldPlots, onFieldGeometryChange, onSelectField]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = unitLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];
    units.forEach((unit) => {
      const latLngs = toPolygonLatLngs(unit.geometry?.coordinates);
      if (latLngs.length < 4) return;
      const isSelected = unit.id === selectedUnitId;
      const isMissionSelected = selectedMissionUnitIdsSet.has(unit.id);
      const polygon = L.polygon(latLngs, {
        color: isSelected ? "rgba(199, 92, 36, 0.98)" : isMissionSelected ? "rgba(58, 109, 214, 0.96)" : "rgba(191, 126, 63, 0.9)",
        fillColor: isSelected ? "rgba(243, 162, 87, 0.26)" : isMissionSelected ? "rgba(91, 140, 246, 0.18)" : "rgba(244, 199, 112, 0.18)",
        fillOpacity: isSelected ? 0.28 : 0.18,
        weight: isSelected ? 2.8 : 1.8,
        opacity: 0.96,
        pane: "planningPane",
        bubblingMouseEvents: false,
      });
      polygon.on("click", () => onSelectUnit(unit.id));
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
    });

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
  }, [onSelectUnit, selectedMissionUnitIdsSet, selectedUnitId, units]);

  useEffect(() => {
    const layer = splitLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
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
  }, [splitMode, splitPoints]);

  return <div ref={mapElementRef} className="h-full min-h-[22rem] w-full rounded-[28px]" />;
}
