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
];
