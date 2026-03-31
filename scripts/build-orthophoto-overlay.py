#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from PIL import Image

Image.MAX_IMAGE_PIXELS = None


def usage() -> None:
    print(
        "Bruk: build-orthophoto-overlay.py <input.tif> <output-image.(webp|png|jpg)> <output-metadata.json> [label]",
        file=sys.stderr,
    )


def run_exiftool(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        ["exiftool", "-j", str(path)],
        check=True,
        capture_output=True,
        text=True,
    )
    parsed = json.loads(result.stdout)
    if not parsed or not isinstance(parsed, list) or not isinstance(parsed[0], dict):
        raise ValueError("ExifTool returnerte ikke forventet JSON.")
    return parsed[0]


def parse_number_list(value: str) -> list[float]:
    return [float(part) for part in re.split(r"\s+", value.strip()) if part]


def utm_to_latlon(easting: float, northing: float, zone_number: int, northern: bool = True) -> tuple[float, float]:
    a = 6378137.0
    e = 0.08181919084262149
    e1sq = 0.006739496742276434
    k0 = 0.9996

    x = easting - 500000.0
    y = northing
    if not northern:
        y -= 10000000.0

    m = y / k0
    mu = m / (a * (1 - e**2 / 4 - 3 * e**4 / 64 - 5 * e**6 / 256))

    e1 = (1 - math.sqrt(1 - e**2)) / (1 + math.sqrt(1 - e**2))
    j1 = 3 * e1 / 2 - 27 * e1**3 / 32
    j2 = 21 * e1**2 / 16 - 55 * e1**4 / 32
    j3 = 151 * e1**3 / 96
    j4 = 1097 * e1**4 / 512

    fp = mu + j1 * math.sin(2 * mu) + j2 * math.sin(4 * mu) + j3 * math.sin(6 * mu) + j4 * math.sin(8 * mu)
    c1 = e1sq * math.cos(fp) ** 2
    t1 = math.tan(fp) ** 2
    r1 = a * (1 - e**2) / ((1 - (e * math.sin(fp)) ** 2) ** 1.5)
    n1 = a / math.sqrt(1 - (e * math.sin(fp)) ** 2)
    d = x / (n1 * k0)

    q1 = n1 * math.tan(fp) / r1
    q2 = d**2 / 2
    q3 = (5 + 3 * t1 + 10 * c1 - 4 * c1**2 - 9 * e1sq) * d**4 / 24
    q4 = (61 + 90 * t1 + 298 * c1 + 45 * t1**2 - 252 * e1sq - 3 * c1**2) * d**6 / 720
    lat = fp - q1 * (q2 - q3 + q4)

    q5 = d
    q6 = (1 + 2 * t1 + c1) * d**3 / 6
    q7 = (5 - 2 * c1 + 28 * t1 - 3 * c1**2 + 8 * e1sq + 24 * t1**2) * d**5 / 120
    lon = (q5 - q6 + q7) / math.cos(fp)
    lon0 = math.radians((zone_number - 1) * 6 - 180 + 3)
    lon = lon0 + lon

    return math.degrees(lat), math.degrees(lon)


def build_metadata(exif: dict[str, Any]) -> dict[str, Any]:
    projected_cs = str(exif.get("ProjectedCSType") or exif.get("Projected CS Type") or "").strip()
    if projected_cs != "WGS84 UTM zone 32N":
        raise ValueError(f"Støtter foreløpig bare WGS84 UTM zone 32N, fikk: {projected_cs!r}")

    width = int(exif.get("ImageWidth") or exif["Image Width"])
    height = int(exif.get("ImageHeight") or exif["Image Height"])
    pixel_scale = parse_number_list(str(exif.get("PixelScale") or exif["Pixel Scale"]))
    tie_point = parse_number_list(str(exif.get("ModelTiePoint") or exif["Model Tie Point"]))
    scale_x = pixel_scale[0]
    scale_y = pixel_scale[1]
    x0 = tie_point[3]
    y0 = tie_point[4]
    x1 = x0 + width * scale_x
    y1 = y0 - height * scale_y

    north, west = utm_to_latlon(x0, y0, 32, True)
    south, east = utm_to_latlon(x1, y1, 32, True)

    return {
        "width_px": width,
        "height_px": height,
        "utm_bounds": {
            "westing": x0,
            "southing": y1,
            "easting": x1,
            "northing": y0,
        },
        "latlng_bounds": {
            "south": south,
            "west": west,
            "north": north,
            "east": east,
        },
        "crs": projected_cs,
    }


def pixel_to_latlng(metadata: dict[str, Any], pixel_x: float, pixel_y: float) -> tuple[float, float]:
    utm = metadata["utm_bounds"]
    width = metadata["width_px"]
    height = metadata["height_px"]
    x = utm["westing"] + (pixel_x / width) * (utm["easting"] - utm["westing"])
    y = utm["northing"] - (pixel_y / height) * (utm["northing"] - utm["southing"])
    return utm_to_latlon(x, y, 32, True)


def export_image(input_path: Path, output_path: Path, metadata: dict[str, Any]) -> tuple[int, int]:
    with Image.open(input_path) as image:
        image = image.convert("RGBA")
        alpha = image.getchannel("A")
        crop_box = alpha.getbbox()
        if crop_box:
            left, top, right, bottom = crop_box
            if left > 0 or top > 0 or right < image.width or bottom < image.height:
                image = image.crop(crop_box)
                north, west = pixel_to_latlng(metadata, left, top)
                south, east = pixel_to_latlng(metadata, right, bottom)
                metadata["latlng_bounds"] = {
                    "south": south,
                    "west": west,
                    "north": north,
                    "east": east,
                }
                metadata["crop_box_px"] = {
                    "left": left,
                    "top": top,
                    "right": right,
                    "bottom": bottom,
                }

        max_width = 2400
        if image.width > max_width:
            ratio = max_width / image.width
            target_size = (max_width, max(1, int(image.height * ratio)))
            image = image.resize(target_size, Image.Resampling.LANCZOS)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        suffix = output_path.suffix.lower()
        if suffix == ".png":
            image.save(output_path, format="PNG", optimize=True)
        elif suffix == ".webp":
            image.save(output_path, format="WEBP", quality=88, method=6)
        else:
            image = image.convert("RGB")
            image.save(output_path, format="JPEG", quality=90, optimize=True)
        return image.width, image.height


def main() -> int:
    if len(sys.argv) < 4:
        usage()
        return 1

    input_path = Path(sys.argv[1]).expanduser().resolve()
    output_image = Path(sys.argv[2]).expanduser().resolve()
    output_metadata = Path(sys.argv[3]).expanduser().resolve()
    label = sys.argv[4] if len(sys.argv) > 4 else input_path.stem

    exif = run_exiftool(input_path)
    metadata = build_metadata(exif)
    preview_width, preview_height = export_image(input_path, output_image, metadata)
    metadata.update(
        {
            "label": label,
            "source_file": str(input_path),
            "preview_file": str(output_image),
            "preview_width_px": preview_width,
            "preview_height_px": preview_height,
        }
    )

    output_metadata.parent.mkdir(parents=True, exist_ok=True)
    output_metadata.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    print(json.dumps(metadata, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
