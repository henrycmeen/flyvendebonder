#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path
from typing import Any

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

TILE_SIZE = 256


def clamp_latitude(value: float) -> float:
    return max(min(value, 85.05112878), -85.05112878)


def latlng_to_global_pixel(lat: float, lng: float, zoom: int, tile_size: int = TILE_SIZE) -> tuple[float, float]:
    lat = clamp_latitude(lat)
    sin_lat = math.sin(math.radians(lat))
    world_size = tile_size * (2**zoom)
    x = ((lng + 180.0) / 360.0) * world_size
    y = (0.5 - math.log((1 + sin_lat) / (1 - sin_lat)) / (4 * math.pi)) * world_size
    return x, y


def read_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} inneholder ikke et JSON-objekt.")
    return payload


def source_crop_box(metadata: dict[str, Any], image: Image.Image) -> tuple[int, int, int, int]:
    width = int(metadata.get("width_px") or 0)
    height = int(metadata.get("height_px") or 0)
    crop = metadata.get("crop_box_px")
    if not isinstance(crop, dict):
        return (0, 0, image.width, image.height)

    if image.width != width or image.height != height:
        return (0, 0, image.width, image.height)

    left = int(crop.get("left", 0))
    top = int(crop.get("top", 0))
    right = int(crop.get("right", image.width))
    bottom = int(crop.get("bottom", image.height))
    return (
        max(0, min(left, image.width)),
        max(0, min(top, image.height)),
        max(0, min(right, image.width)),
        max(0, min(bottom, image.height)),
    )


def detect_source_kind(metadata: dict[str, Any], image: Image.Image) -> str:
    preview_width = metadata.get("preview_width_px")
    preview_height = metadata.get("preview_height_px")
    if image.width == preview_width and image.height == preview_height:
        return "preview"
    return "canonical"


def bounds_from_metadata(metadata: dict[str, Any]) -> dict[str, float]:
    bounds = metadata.get("latlng_bounds") or metadata.get("overlay", {}).get("bounds")
    if not isinstance(bounds, dict):
        raise ValueError("Metadata mangler latlng_bounds/overlay.bounds.")
    return {
        "south": float(bounds["south"]),
        "west": float(bounds["west"]),
        "north": float(bounds["north"]),
        "east": float(bounds["east"]),
    }


def image_overlay_rect(bounds: dict[str, float], zoom: int, tile_size: int) -> tuple[float, float, float, float]:
    west, north = latlng_to_global_pixel(bounds["north"], bounds["west"], zoom, tile_size)
    east, south = latlng_to_global_pixel(bounds["south"], bounds["east"], zoom, tile_size)
    return west, north, east, south


def output_suffix(image_format: str) -> str:
    if image_format == "png":
        return "png"
    if image_format == "jpg":
        return "jpg"
    return "webp"


def save_tile(tile: Image.Image, path: Path, image_format: str, quality: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if image_format == "png":
        tile.save(path, format="PNG", optimize=True)
        return
    if image_format == "jpg":
        tile.convert("RGB").save(path, format="JPEG", quality=quality, optimize=True)
        return
    tile.save(path, format="WEBP", quality=quality, method=6)


def clear_previous_tiles(output_dir: Path) -> None:
    if not output_dir.exists():
        return
    for child in output_dir.iterdir():
        if child.is_dir() and child.name.isdigit():
            shutil.rmtree(child)
    manifest_path = output_dir / "manifest.json"
    if manifest_path.exists():
        manifest_path.unlink()


def build_tiles(
    source_image: Path,
    metadata_path: Path,
    output_dir: Path,
    *,
    min_zoom: int,
    max_zoom: int,
    tile_size: int = TILE_SIZE,
    image_format: str = "webp",
    quality: int = 86,
    overlay_id: str | None = None,
) -> dict[str, Any]:
    metadata = read_json(metadata_path)
    bounds = bounds_from_metadata(metadata)
    suffix = output_suffix(image_format)
    clear_previous_tiles(output_dir)

    with Image.open(source_image) as opened:
        source_kind = detect_source_kind(metadata, opened)
        crop_box = source_crop_box(metadata, opened)
        image = opened.convert("RGBA").crop(crop_box)

        tile_count = 0
        for zoom in range(min_zoom, max_zoom + 1):
            overlay_left, overlay_top, overlay_right, overlay_bottom = image_overlay_rect(bounds, zoom, tile_size)
            min_x = math.floor(overlay_left / tile_size)
            max_x = math.floor((overlay_right - 0.000001) / tile_size)
            min_y = math.floor(overlay_top / tile_size)
            max_y = math.floor((overlay_bottom - 0.000001) / tile_size)

            for x in range(min_x, max_x + 1):
                for y in range(min_y, max_y + 1):
                    tile_left = x * tile_size
                    tile_top = y * tile_size
                    tile_right = tile_left + tile_size
                    tile_bottom = tile_top + tile_size

                    inter_left = max(tile_left, overlay_left)
                    inter_top = max(tile_top, overlay_top)
                    inter_right = min(tile_right, overlay_right)
                    inter_bottom = min(tile_bottom, overlay_bottom)
                    if inter_right <= inter_left or inter_bottom <= inter_top:
                        continue

                    src_left = (inter_left - overlay_left) / (overlay_right - overlay_left) * image.width
                    src_top = (inter_top - overlay_top) / (overlay_bottom - overlay_top) * image.height
                    src_right = (inter_right - overlay_left) / (overlay_right - overlay_left) * image.width
                    src_bottom = (inter_bottom - overlay_top) / (overlay_bottom - overlay_top) * image.height

                    dst_left = round(inter_left - tile_left)
                    dst_top = round(inter_top - tile_top)
                    dst_right = round(inter_right - tile_left)
                    dst_bottom = round(inter_bottom - tile_top)
                    dst_width = max(1, dst_right - dst_left)
                    dst_height = max(1, dst_bottom - dst_top)

                    crop = image.crop((src_left, src_top, src_right, src_bottom))
                    resized = crop.resize((dst_width, dst_height), Image.Resampling.LANCZOS)
                    tile = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
                    tile.paste(resized, (dst_left, dst_top), resized)
                    save_tile(tile, output_dir / str(zoom) / str(x) / f"{y}.{suffix}", image_format, quality)
                    tile_count += 1

    canonical_width = int(metadata.get("crop_box_px", {}).get("right", metadata.get("width_px", 0))) - int(
        metadata.get("crop_box_px", {}).get("left", 0)
    )
    canonical_height = int(metadata.get("crop_box_px", {}).get("bottom", metadata.get("height_px", 0))) - int(
        metadata.get("crop_box_px", {}).get("top", 0)
    )
    if canonical_width <= 0:
        canonical_width = int(metadata.get("width_px") or 0)
    if canonical_height <= 0:
        canonical_height = int(metadata.get("height_px") or 0)

    manifest = {
        "id": output_dir.name,
        "overlayId": overlay_id or metadata.get("overlay", {}).get("id") or output_dir.name,
        "sourceKind": source_kind,
        "sourceImage": source_image.name,
        "sourceWidthPx": image.width,
        "sourceHeightPx": image.height,
        "canonicalWidthPx": canonical_width,
        "canonicalHeightPx": canonical_height,
        "previewWidthPx": metadata.get("preview_width_px"),
        "previewHeightPx": metadata.get("preview_height_px"),
        "bounds": bounds,
        "tileSize": tile_size,
        "format": suffix,
        "minZoom": min_zoom,
        "maxZoom": max_zoom,
        "maxNativeZoom": max_zoom,
        "tileCount": tile_count,
        "qualityScale": round(canonical_width / image.width, 2) if image.width else None,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Bygg statiske XYZ-tiles for ett georeferert ortofoto.")
    parser.add_argument("source_image", help="Kildebilde, helst full ODM GeoTIFF/COG. Preview-webp kan brukes for prototype.")
    parser.add_argument("metadata_json", help="Metadata fra build-orthophoto-overlay.py.")
    parser.add_argument("output_dir", help="Mappe som skal inneholde z/x/y-tiles og manifest.json.")
    parser.add_argument("--id", dest="overlay_id", help="Overlay-ID som tilesettet hører til.")
    parser.add_argument("--min-zoom", type=int, default=14)
    parser.add_argument("--max-zoom", type=int, default=19)
    parser.add_argument("--tile-size", type=int, default=TILE_SIZE)
    parser.add_argument("--format", choices=["webp", "png", "jpg"], default="webp")
    parser.add_argument("--quality", type=int, default=86)
    args = parser.parse_args()

    manifest = build_tiles(
        Path(args.source_image).expanduser().resolve(),
        Path(args.metadata_json).expanduser().resolve(),
        Path(args.output_dir).expanduser().resolve(),
        min_zoom=args.min_zoom,
        max_zoom=args.max_zoom,
        tile_size=args.tile_size,
        image_format=args.format,
        quality=args.quality,
        overlay_id=args.overlay_id,
    )
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
