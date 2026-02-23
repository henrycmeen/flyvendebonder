export type BaseMapStyle = "none" | "osm" | "topo" | "light" | "voyager" | "satellite";

interface BaseMapStyleConfig {
  id: BaseMapStyle;
  label: string;
  tileUrl: string | null;
  attribution: string;
  maxZoom: number;
  subdomains?: string;
}

export const BASE_MAP_STYLE_ORDER: BaseMapStyle[] = ["none", "osm", "topo", "voyager", "light", "satellite"];

export const BASE_MAP_STYLES: Record<BaseMapStyle, BaseMapStyleConfig> = {
  none: {
    id: "none",
    label: "Ingen bakgrunn",
    tileUrl: null,
    attribution: "",
    maxZoom: 20,
  },
  osm: {
    id: "osm",
    label: "Standard",
    tileUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 20,
  },
  topo: {
    id: "topo",
    label: "Topografisk",
    tileUrl: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution:
      'Kartdata: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | Stil: &copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
  light: {
    id: "light",
    label: "Lys",
    tileUrl: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd",
  },
  voyager: {
    id: "voyager",
    label: "Illustrert",
    tileUrl: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 20,
    subdomains: "abcd",
  },
  satellite: {
    id: "satellite",
    label: "Satellitt",
    tileUrl: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri",
    maxZoom: 20,
  },
};
