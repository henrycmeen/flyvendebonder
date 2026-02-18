import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet.markercluster";

import type { GardskartJob, PhotoFeature, Property } from "@/types";
import { BASE_MAP_STYLES, type BaseMapStyle } from "@/lib/map-styles";

interface MapCanvasProps {
  photos: PhotoFeature[];
  selectedPhotoId: string | null;
  hoveredPhotoId: string | null;
  focusToken: number;
  resetViewToken: number;
  property: Property | null;
  job: GardskartJob | null;
  baseMapStyle: BaseMapStyle;
  mapGrayscale: boolean;
  mapVintage: boolean;
  showPropertyLayer: boolean;
  onSelectPhoto: (photoId: string) => void;
  onHoverPhoto: (photoId: string | null) => void;
  onOpenPhotoFullscreen: (photoId: string) => void;
  onPropertyStatus: (text: string) => void;
  onPropertyTileError: (jobId: string) => void;
}

const fallbackCenter: [number, number] = [59.1708, 9.6607];

type LatLngPair = [number, number];
type MediaKind = "drone" | "camera";

const mapCameraIconUrl = `${import.meta.env.BASE_URL}icon-marker-camera.svg`;

function inferMediaKind(photo: PhotoFeature): MediaKind {
  const haystack = [photo.title, ...(photo.tags ?? [])].join(" ").toLowerCase();
  if (haystack.includes("drone") || haystack.includes("dronefoto") || haystack.includes("dji")) {
    return "drone";
  }
  return "camera";
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

function toPolygonLatLngs(raw: number[][][] | null | undefined): LatLngPair[] {
  if (!raw || raw.length === 0 || !Array.isArray(raw[0])) return [];
  const parsed: (LatLngPair | null)[] = raw[0].map(([lng, lat]) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
    return [lat, lng];
  });
  return parsed.filter((item): item is LatLngPair => item !== null);
}

function getAnalysisTarget(photo: PhotoFeature): LatLngPair | null {
  if (photo.analysis_zone?.center_point) {
    return toLatLngFromPoint(photo.analysis_zone.center_point);
  }
  if (photo.view_lat == null || photo.view_lng == null) return null;
  return [photo.view_lat, photo.view_lng];
}

function mapMediaPinIcon(
  kind: MediaKind,
  active: boolean,
  photo: PhotoFeature | null,
): L.DivIcon {
  const className = buildPinClassName(active, photo);
  const pinVisual =
    kind === "drone"
      ? '<span class="fb-media-pin-core" aria-hidden="true"><span class="fb-media-pin-core-dot"></span></span>'
      : `<img src="${mapCameraIconUrl}" alt="" />`;
  return L.divIcon({
    className: "fb-media-pin-shell",
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<span class="${className}" data-kind="${kind}" data-title="${buildPinTitle(photo)}">${pinVisual}</span>`,
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
  property,
  job,
  baseMapStyle,
  mapGrayscale,
  mapVintage,
  showPropertyLayer,
  onSelectPhoto,
  onHoverPhoto,
  onOpenPhotoFullscreen,
  onPropertyStatus,
  onPropertyTileError,
}: MapCanvasProps) {
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersByIdRef = useRef<Map<string, L.Marker>>(new Map());
  const baseLayerRef = useRef<L.TileLayer | null>(null);
  const propertyLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const viewLayerRef = useRef<L.LayerGroup | null>(null);
  const hasFitRef = useRef(false);
  const selectedPhotoIdRef = useRef<string | null>(selectedPhotoId);

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
        zoomControl: true,
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
    }

    map.createPane("laserPane");
    const laserPane = map.getPane("laserPane");
    if (laserPane) {
      laserPane.style.zIndex = "650";
      laserPane.style.pointerEvents = "none";
    }

    const clusterLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16,
      maxClusterRadius: 48,
    });
    map.addLayer(clusterLayer);
    const viewLayer = L.layerGroup();
    viewLayer.addTo(map);
    viewLayerRef.current = viewLayer;

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
      propertyLayerRef.current = null;
      if (viewLayerRef.current) {
        viewLayerRef.current.remove();
        viewLayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current) return;

    if (baseLayerRef.current) {
      mapRef.current.removeLayer(baseLayerRef.current);
      baseLayerRef.current = null;
    }

    const style = BASE_MAP_STYLES[baseMapStyle];
    const layerOptions: L.TileLayerOptions = {
      maxZoom: style.maxZoom,
      attribution: style.attribution,
    };

    if (style.subdomains) {
      layerOptions.subdomains = style.subdomains;
    }

    const layer = L.tileLayer(style.tileUrl, layerOptions);

    layer.addTo(mapRef.current);
    baseLayerRef.current = layer;

    return () => {
      if (mapRef.current && layer) {
        mapRef.current.removeLayer(layer);
      }
    };
  }, [baseMapStyle]);

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
    if (!mapRef.current || !viewLayerRef.current) return;

    viewLayerRef.current.clearLayers();

    const hoverCapable = supportsHoverPointer();
    const activeDirectionPhotoId = hoverCapable ? hoveredPhotoId : selectedPhotoId;
    if (!activeDirectionPhotoId) return;

    const selectedPhoto = photos.find((photo) => photo.id === activeDirectionPhotoId) ?? null;
    if (!selectedPhoto || selectedPhoto.lat == null || selectedPhoto.lng == null) return;

    const target = getAnalysisTarget(selectedPhoto);
    if (target == null) {
      return;
    }

    const source = L.latLng(selectedPhoto.lat, selectedPhoto.lng);
    const targetLatLng = L.latLng(target[0], target[1]);
    if (source.distanceTo(targetLatLng) < 4) {
      return;
    }

    const line = L.polyline([source, targetLatLng], {
      className: "fb-media-viewline",
      color: "rgba(255, 172, 64, 0.95)",
      weight: 2.3,
      opacity: 0.98,
      dashArray: "6 10",
      lineCap: "round",
      interactive: false,
      pane: "laserPane",
    });

    const targetPoint = L.circleMarker(targetLatLng, {
      className: "fb-media-view-target",
      radius: 4.5,
      color: "#8a5120",
      fillColor: "#fff7ea",
      fillOpacity: 1,
      weight: 1.8,
      opacity: 0.96,
      interactive: false,
      pane: "laserPane",
    });

    viewLayerRef.current.addLayer(line);
    viewLayerRef.current.addLayer(targetPoint);

    if (selectedPhoto.analysis_zone?.footprint_polygon?.coordinates) {
      const footprint = toPolygonLatLngs(selectedPhoto.analysis_zone.footprint_polygon.coordinates);
      if (footprint.length > 3) {
        const footprintLayer = L.polygon(footprint, {
          color: "rgba(255, 172, 64, 0.6)",
          fillColor: "rgba(255, 196, 102, 0.2)",
          fillOpacity: 0.2,
          weight: 1.4,
          opacity: 0.86,
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
        color: "rgba(255, 172, 64, 0.26)",
        fillColor: "rgba(255, 196, 102, 0.08)",
        fillOpacity: 0.14,
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
            color: "#f4e7c7",
            fillColor: "#ffdf9d",
            fillOpacity: 0.95,
            weight: 1,
            opacity: 0.9,
            interactive: false,
            pane: "laserPane",
          }),
        );
      }
    }
  }, [hoveredPhotoId, photos, selectedPhotoId]);

  useEffect(() => {
    if (!mapRef.current || !markersRef.current) return;

    const desktopHover = supportsHoverPointer();

    markersRef.current.clearLayers();
    markersByIdRef.current.clear();

    photos.forEach((photo) => {
      const mediaKind = inferMediaKind(photo);
      const marker = L.marker([photo.lat, photo.lng], {
        icon: mapMediaPinIcon(mediaKind, false, photo),
      });
      const photoImageUrl = photo.thumbnail_url || photo.image_url || "";
      const popupContent = document.createElement("div");
      popupContent.className = "photo-popup-card";

      const openInFullscreen = () => {
        onOpenPhotoFullscreen(photo.id);
      };

      if (photoImageUrl) {
        const popupImage = document.createElement("img");
        popupImage.src = photoImageUrl;
        popupImage.alt = photo.title || "Foto";
        popupImage.decoding = "async";
        popupImage.loading = "lazy";
        popupImage.tabIndex = 0;
        popupImage.setAttribute("role", "button");
        popupImage.setAttribute("aria-label", `Åpne ${photo.title || "foto"} i fullskjerm`);
        popupImage.addEventListener("click", openInFullscreen);
        popupImage.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openInFullscreen();
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
          openInFullscreen();
        });
        popupContent.appendChild(popupFullscreenButton);
      } else {
        const popupImagePlaceholder = document.createElement("div");
        popupImagePlaceholder.className = "photo-popup-card__empty";
        popupContent.appendChild(popupImagePlaceholder);
      }

      marker.bindPopup(popupContent, {
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

    if (photos.length > 0 && !hasFitRef.current) {
      const bounds = L.latLngBounds(photos.map((photo) => [photo.lat, photo.lng] as [number, number]));
      mapRef.current.fitBounds(bounds.pad(0.2), { animate: true });
      hasFitRef.current = true;
    }
  }, [onHoverPhoto, onOpenPhotoFullscreen, onSelectPhoto, photos]);

  useEffect(() => {
    markersByIdRef.current.forEach((marker, id) => {
      const markerPhoto = photos.find((photo) => photo.id === id) ?? null;
      const kind = markerPhoto ? inferMediaKind(markerPhoto) : "drone";
      const isSelected = id === selectedPhotoId;
      const isHovered = id === hoveredPhotoId;
      const active = isSelected || isHovered;
      marker.setIcon(mapMediaPinIcon(kind, active, markerPhoto));
    });
  }, [hoveredPhotoId, photos, selectedPhotoId]);

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

    if (propertyLayerRef.current) {
      mapRef.current.removeLayer(propertyLayerRef.current);
      propertyLayerRef.current = null;
    }

    if (!showPropertyLayer) {
      onPropertyStatus("Eiendomslag er skrudd av.");
      return;
    }

    if (!property || !job) {
      onPropertyStatus("Eiendomslag venter på gyldig jobId ...");
      return;
    }

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

    layer.on("load", () => {
      const propertyText = `${property.komm}-${property.gnr}/${property.bnr}/${property.fnr}`;
      if (isNIBIOStatusOk(job.status_code, job.status_desc)) {
        onPropertyStatus(`Eiendomslag aktivt (${propertyText})`);
      } else if (job.status_code === 100) {
        onPropertyStatus(`NIBIO kunne ikke hente eiendomsgrenser for ${propertyText} nå (kode 100).`);
      } else {
        onPropertyStatus(`Eiendomslag aktivt (${propertyText}). NIBIO meldte avvik, se teknisk logg.`);
      }
    });

    layer.on("tileerror", () => {
      onPropertyStatus("Eiendomslag feilet. Prøver automatisk oppfriskning ...");
      onPropertyTileError(job.job_id);
    });

    layer.addTo(mapRef.current);
    propertyLayerRef.current = layer;

    return () => {
      if (mapRef.current && layer) {
        mapRef.current.removeLayer(layer);
      }
    };
  }, [job, onPropertyStatus, onPropertyTileError, property, showPropertyLayer, baseMapStyle]);

  return (
    <div className="absolute inset-0 z-0">
      <div ref={mapElementRef} className="absolute inset-0" aria-label="Kart med geotaggede bilder" />
      {mapVintage ? <div className="map-vintage-overlay" aria-hidden="true" /> : null}
    </div>
  );
}
