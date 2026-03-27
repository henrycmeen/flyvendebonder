from __future__ import annotations

from datetime import datetime

from ..models import FlightCapture, ProcessingArtifact, ProcessingRun

STAC_VERSION = "1.1.0"
STAC_PROJECTION_EXTENSION = "https://stac-extensions.github.io/projection/v2.0.0/schema.json"
STAC_COLLECTION_LICENSE = "proprietary"
STAC_ITEM_ASSETS = {
    "ortho": {
        "title": "Ortofoto",
        "description": "Kanonisk orthofil for itemet.",
        "type": "image/tiff; application=geotiff; profile=cloud-optimized",
        "roles": ["data"],
    },
    "tiles": {
        "title": "Tiles",
        "description": "Tile-entrypoint for kartvisning.",
        "type": "application/json",
        "roles": ["metadata"],
    },
    "thumb": {
        "title": "Thumbnail",
        "description": "Liten forhåndsvisning for UI.",
        "type": "image/jpeg",
        "roles": ["thumbnail"],
    },
    "metadata": {
        "title": "Prosesseringsmetadata",
        "description": "Teknisk JSON med prosesserings- og artefaktmetadata.",
        "type": "application/json",
        "roles": ["metadata"],
    },
}
STAC_ASSET_KINDS = {"ortho", "tiles", "thumb"}


def stac_collection_id(capture: FlightCapture) -> str:
    return f"capture-{capture.id}"


def stac_item_id(run: ProcessingRun) -> str:
    return f"processing-run-{run.id}"


def stac_collection_title(capture: FlightCapture) -> str:
    if capture.name and capture.name.strip():
        return capture.name.strip()
    return f"Flight capture {capture.id}"


def stac_collection_description(capture: FlightCapture) -> str:
    return f"Minimal STAC Collection for prosesseringsartefakter fra flight capture {capture.id}."


def processing_run_temporal(
    capture: FlightCapture,
    run: ProcessingRun,
) -> tuple[str | None, str | None, str | None]:
    start = capture.captured_from or run.started_at or capture.created_at
    end = capture.captured_to or run.finished_at or run.updated_at
    if start and end and end < start:
        end = start
    start_value = _isoformat(start)
    end_value = _isoformat(end)
    if start_value and end_value and start_value == end_value:
        return start_value, None, None
    return None, start_value, end_value


def stac_asset_key(artifact: ProcessingArtifact) -> str | None:
    if artifact.kind in STAC_ASSET_KINDS:
        return artifact.kind
    return None


def stac_bbox_to_geometry(bbox: list[float]) -> dict:
    min_lng, min_lat, max_lng, max_lat = bbox
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [min_lng, min_lat],
                [max_lng, min_lat],
                [max_lng, max_lat],
                [min_lng, max_lat],
                [min_lng, min_lat],
            ]
        ],
    }


def _normalize_bbox_values(value) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 4:
        return None
    try:
        return [float(item) for item in value]
    except (TypeError, ValueError):
        return None


def _geometry_points(value) -> list[list[float]]:
    if not isinstance(value, list):
        return []
    if len(value) >= 2 and not isinstance(value[0], list) and not isinstance(value[1], list):
        try:
            return [[float(value[0]), float(value[1])]]
        except (TypeError, ValueError):
            return []

    points: list[list[float]] = []
    for item in value:
        points.extend(_geometry_points(item))
    return points


def geometry_bbox(geometry: dict) -> list[float]:
    coordinates = geometry.get("coordinates") or []
    points = _geometry_points(coordinates)
    if not points:
        raise ValueError("Geometry mangler koordinater")
    lng_values = [float(point[0]) for point in points]
    lat_values = [float(point[1]) for point in points]
    return [
        min(lng_values),
        min(lat_values),
        max(lng_values),
        max(lat_values),
    ]


def union_bboxes(boxes: list[list[float]]) -> list[float]:
    return [
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    ]


def _isoformat(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.replace(microsecond=0).isoformat() + "Z"
