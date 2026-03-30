from __future__ import annotations

import json
from typing import Any

import httpx

from ..config import get_settings

TERRAIN_SOURCE_KARTVERKET_DEM = "kartverket-dtm"

settings = get_settings()


class TerrainSamplingError(RuntimeError):
    pass


def sample_terrain_elevations(points: list[dict[str, float]]) -> list[float | None]:
    if not points:
        return []

    elevations: list[float | None] = [None] * len(points)
    batch_size = max(1, int(settings.terrain_sample_batch_size))

    try:
        with httpx.Client(timeout=settings.terrain_http_timeout_seconds) as client:
            for offset in range(0, len(points), batch_size):
                batch = points[offset : offset + batch_size]
                geometry = {
                    "points": [[point["lng"], point["lat"]] for point in batch],
                    "spatialReference": {"wkid": 4326},
                }
                response = client.get(
                    f"{settings.terrain_dem_image_server_url.rstrip('/')}/getSamples",
                    params={
                        "geometry": json.dumps(geometry, separators=(",", ":")),
                        "geometryType": "esriGeometryMultipoint",
                        "returnFirstValueOnly": "true",
                        "f": "pjson",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict):
                    raise TerrainSamplingError("Ugyldig respons fra terrengtjenesten")
                if payload.get("error"):
                    raise TerrainSamplingError(str(payload["error"]))
                samples = payload.get("samples")
                if not isinstance(samples, list):
                    raise TerrainSamplingError("Terrengtjenesten returnerte ikke sample-liste")

                for sample in samples:
                    if not isinstance(sample, dict):
                        continue
                    location_id = sample.get("locationId")
                    raw_value = sample.get("value")
                    if location_id is None:
                        continue
                    local_index = int(location_id)
                    if local_index < 0 or local_index >= len(batch):
                        continue
                    try:
                        elevations[offset + local_index] = float(raw_value)
                    except (TypeError, ValueError):
                        elevations[offset + local_index] = None
    except httpx.HTTPError as exc:
        raise TerrainSamplingError("Kunne ikke hente terrengdata") from exc

    return elevations


def summarize_terrain_elevations(elevations: list[float | None]) -> tuple[float | None, float | None]:
    numeric_values = [value for value in elevations if value is not None]
    if not numeric_values:
        return None, None
    return round(min(numeric_values), 2), round(max(numeric_values), 2)
