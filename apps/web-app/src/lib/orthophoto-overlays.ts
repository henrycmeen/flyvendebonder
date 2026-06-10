export interface OrthophotoTileLayerDefinition {
  urlTemplate: string;
  minZoom: number;
  maxZoom: number;
  maxNativeZoom: number;
  tileSize: number;
  sourceKind: "canonical" | "preview" | "unknown";
  sourceWidthPx: number;
  sourceHeightPx: number;
  canonicalWidthPx: number;
  canonicalHeightPx: number;
  tileCount: number;
  qualityScale?: number | null;
}

export interface OrthophotoOverlayDefinition {
  id: string;
  label: string;
  propertyReference: string;
  imageUrl: string;
  capturedDate: string;
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  opacity?: number;
  tileLayer?: OrthophotoTileLayerDefinition;
}

// Generert av scripts/sync-orthophoto-overlays.py
export const DEV_ORTHOPHOTO_OVERLAYS: OrthophotoOverlayDefinition[] = [
  {
    id: "jorde-1-orthophoto",
    label: "Jorde 1 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-1-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.16612230454828,
      west: 9.660849230521281,
      north: 59.168199600256415,
      east: 9.664008431253135,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-2-orthophoto",
    label: "Jorde 2 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-2-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.170289744956435,
      west: 9.66318200817048,
      north: 59.17094383863441,
      east: 9.664387228428701,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-3-orthophoto",
    label: "Jorde 3 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-3-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.17016403190133,
      west: 9.660356299911511,
      north: 59.17226936004634,
      east: 9.664885197111735,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-4-orthophoto",
    label: "Jorde 4 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-4-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.172157286621996,
      west: 9.664306674615593,
      north: 59.17549895458715,
      east: 9.676921499587127,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-7-orthophoto",
    label: "Jorde 7 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-7-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.170087369373256,
      west: 9.658432812546847,
      north: 59.1717913755992,
      east: 9.661408410003549,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-8-en-storing-orthophoto",
    label: "Jorde 8 (en storing) ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-8-en-storing-orthophoto.webp`,
    capturedDate: "2026-03-31",
    bounds: {
      south: 59.16788058275153,
      west: 9.660761277453936,
      north: 59.176503235641036,
      east: 9.67681022394976,
    },
    opacity: 0.82,
  },
  {
    id: "jorde-9-orthophoto",
    label: "Jorde 9 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/jorde-9-orthophoto.webp`,
    capturedDate: "2026-04-01",
    bounds: {
      south: 59.133772177086534,
      west: 9.675808011017034,
      north: 59.14028207061983,
      east: 9.682511298918834,
    },
    opacity: 0.82,
    tileLayer: {
      urlTemplate: `${import.meta.env.BASE_URL}dev-overlays/jorde-9-orthophoto-tiles/{z}/{x}/{y}.webp`,
      minZoom: 14,
      maxZoom: 19,
      maxNativeZoom: 19,
      tileSize: 256,
      sourceKind: "preview",
      sourceWidthPx: 2400,
      sourceHeightPx: 4426,
      canonicalWidthPx: 14324,
      canonicalHeightPx: 26416,
      tileCount: 300,
      qualityScale: 5.97,
    },
  },
  {
    id: "skog-1-orthophoto",
    label: "Skog 1 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/skog-1-orthophoto.webp`,
    capturedDate: "2026-04-03",
    bounds: {
      south: 59.186112922757985,
      west: 9.712905678850092,
      north: 59.191339250943315,
      east: 9.724716385440372,
    },
    opacity: 0.82,
  },
  {
    id: "skog-2-orthophoto",
    label: "Skog 2 ortofoto",
    propertyReference: "4003-70/17/0",
    imageUrl: `${import.meta.env.BASE_URL}dev-overlays/skog-2-orthophoto.webp`,
    capturedDate: "2026-04-03",
    bounds: {
      south: 59.18254412555932,
      west: 9.702034636784974,
      north: 59.18973808317092,
      east: 9.710431825749264,
    },
    opacity: 0.82,
  },
];
