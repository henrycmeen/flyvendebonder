#!/usr/bin/env python3
"""Import curated drone images from Analysebilder into demo-fotokart.

- Copies a selected number of images per configured folder
- Resizes images for web
- Generates data/photos.geojson and data/story.json from EXIF GPS/time
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable


DEFAULT_SOURCE = Path("/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder")
DEFAULT_APP_DIR = Path(
    "/Users/henmee/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Vault/03. Prosjekter/Flyvendebønder/apps/demo-fotokart"
)


@dataclass(frozen=True)
class ChapterConfig:
    folder: str
    slug: str
    title: str
    description: str
    tags: list[str]


CHAPTERS: list[ChapterConfig] = [
    ChapterConfig(
        folder="010724",
        slug="oppstart-2024",
        title="Kapittel 1: Oppstart sommer 2024",
        description="De første flygningene og grunnkartlegging på Meen gård.",
        tags=["oppstart", "juli-2024"],
    ),
    ChapterConfig(
        folder="030824",
        slug="sensommer-2024",
        title="Kapittel 2: Sensommer august 2024",
        description="Mønstre og avvik dokumentert i august.",
        tags=["sensommer", "august-2024"],
    ),
    ChapterConfig(
        folder="271024",
        slug="host-2024",
        title="Kapittel 3: Høst oktober 2024",
        description="Høstflygning med oppdaterte observasjoner.",
        tags=["host", "oktober-2024"],
    ),
    ChapterConfig(
        folder="juli2025",
        slug="sommer-2025",
        title="Kapittel 4: Oppfølging juli 2025",
        description="Ny runde i 2025 for å sammenligne utvikling.",
        tags=["oppfolging", "juli-2025"],
    ),
]


def find_images(folder: Path) -> list[Path]:
    if not folder.exists() or not folder.is_dir():
        return []
    images = sorted(
        [
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg"}
        ]
    )
    return images


def run_exiftool(paths: Iterable[Path]) -> dict[str, dict]:
    path_list = [str(path) for path in paths]
    if not path_list:
        return {}

    cmd = [
        "exiftool",
        "-q",
        "-q",
        "-n",
        "-j",
        "-DateTimeOriginal",
        "-GPSLatitude",
        "-GPSLongitude",
    ] + path_list
    data = json.loads(subprocess.check_output(cmd))
    return {entry["SourceFile"]: entry for entry in data}


def normalize_stem(path: Path) -> str:
    stem = path.stem.lower()
    if stem.startswith("dji_"):
        stem = stem.replace("dji_", "", 1)
    return f"meen-{stem}"


def copy_and_resize(src: Path, dst: Path, max_pixels: int) -> None:
    shutil.copy2(src, dst)
    subprocess.run(
        ["sips", "-Z", str(max_pixels), str(dst)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Import Analysebilder into demo-fotokart")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--app-dir", type=Path, default=DEFAULT_APP_DIR)
    parser.add_argument("--per-folder", type=int, default=3)
    parser.add_argument("--max-pixels", type=int, default=1800)
    args = parser.parse_args()

    photos_dir = args.app_dir / "assets" / "photos"
    data_dir = args.app_dir / "data"
    photos_dir.mkdir(parents=True, exist_ok=True)
    data_dir.mkdir(parents=True, exist_ok=True)

    # Clean previously imported files from this pipeline.
    for old in photos_dir.glob("meen-*.jpg"):
        old.unlink()

    selected: list[tuple[Path, ChapterConfig]] = []
    for chapter in CHAPTERS:
        files = find_images(args.source / chapter.folder)
        if not files:
            print(f"Skipping missing/empty folder: {chapter.folder}")
            continue
        for image in files[: args.per_folder]:
            selected.append((image, chapter))

    if not selected:
        print("No source images selected. Nothing to import.", file=sys.stderr)
        return 1

    metadata = run_exiftool([image for image, _ in selected])

    features = []
    chapter_points: dict[str, list[tuple[float, float]]] = {}

    for image, chapter in selected:
        exif = metadata.get(str(image), {})
        lat = exif.get("GPSLatitude")
        lon = exif.get("GPSLongitude")
        dt_raw = exif.get("DateTimeOriginal")

        if lat is None or lon is None or not dt_raw:
            print(f"Skipping image without GPS/time: {image}")
            continue

        date_obj = datetime.strptime(dt_raw, "%Y:%m:%d %H:%M:%S")
        date_iso = date_obj.strftime("%Y-%m-%d")

        stem = normalize_stem(image)
        dst_name = f"{stem}.jpg"
        dst_path = photos_dir / dst_name
        copy_and_resize(image, dst_path, args.max_pixels)

        rel_image = f"./assets/photos/{dst_name}"
        feature = {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {
                "id": stem,
                "title": f"Meen gård {date_iso} – {image.stem}",
                "date": date_iso,
                "tags": ["meen-gard", "dronefoto", *chapter.tags],
                "chapter": chapter.slug,
                "thumbnail": rel_image,
                "image": rel_image,
                "caption": f"Dronefoto fra {chapter.folder}. Kilde: {image.name}.",
            },
        }
        features.append(feature)
        chapter_points.setdefault(chapter.slug, []).append((lat, lon))

    features.sort(key=lambda item: item["properties"]["date"])

    chapters_out = []
    for chapter in CHAPTERS:
        points = chapter_points.get(chapter.slug, [])
        if not points:
            continue
        avg_lat = sum(lat for lat, _ in points) / len(points)
        avg_lon = sum(lon for _, lon in points) / len(points)
        chapters_out.append(
            {
                "slug": chapter.slug,
                "title": chapter.title,
                "description": chapter.description,
                "focus": {"lat": round(avg_lat, 6), "lng": round(avg_lon, 6), "zoom": 14},
                "filter": {"chapter": chapter.slug},
            }
        )

    story = {
        "title": "Flyvendebønder fotokart-demo",
        "subtitle": f"Kuratert utvalg fra {args.source}.",
        "chapters": chapters_out,
    }

    geojson = {"type": "FeatureCollection", "features": features}

    (data_dir / "story.json").write_text(
        json.dumps(story, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    (data_dir / "photos.geojson").write_text(
        json.dumps(geojson, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    print(f"Imported {len(features)} images to {photos_dir}")
    print(f"Wrote story.json and photos.geojson to {data_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
