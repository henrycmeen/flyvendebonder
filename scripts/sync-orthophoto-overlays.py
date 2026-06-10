#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class OverlayProject:
    project_name: str
    source_dir: Path | None
    orthophoto_tif: Path
    label: str


def season_from_date(value: str) -> str:
    month = int(value[5:7])
    if month in (3, 4, 5):
        return "spring"
    if month in (6, 7, 8):
        return "summer"
    if month in (9, 10, 11):
        return "autumn"
    return "winter"


def run_exiftool_json(*args: str) -> list[dict[str, Any]]:
    result = subprocess.run(
        ["exiftool", "-j", *args],
        check=True,
        capture_output=True,
        text=True,
    )
    parsed = json.loads(result.stdout)
    if not isinstance(parsed, list):
        raise ValueError("ExifTool returnerte ikke liste.")
    return [item for item in parsed if isinstance(item, dict)]


def load_source_dir(project_dir: Path) -> Path | None:
    manifest = project_dir / "source-manifest.txt"
    if not manifest.exists():
        return None
    for line in manifest.read_text(encoding="utf-8").splitlines():
        if line.startswith("source_dir="):
            source_dir = Path(line.split("=", 1)[1])
            return source_dir if source_dir.exists() else None
    return None


def find_projects(processing_root: Path) -> list[OverlayProject]:
    projects: list[OverlayProject] = []
    for project_dir in sorted(processing_root.iterdir()):
        if not project_dir.is_dir():
            continue
        orthophoto_tif = project_dir / "odm_orthophoto" / "odm_orthophoto.tif"
        if not orthophoto_tif.exists():
            continue
        source_dir = load_source_dir(project_dir)
        label_source = source_dir.name if source_dir else project_dir.name.replace("-", " ")
        label_source = label_source[:1].upper() + label_source[1:]
        projects.append(
            OverlayProject(
                project_name=project_dir.name,
                source_dir=source_dir,
                orthophoto_tif=orthophoto_tif,
                label=f"{label_source} ortofoto",
            )
        )
    return projects


def find_captured_date(source_dir: Path | None, project_dir: Path) -> str:
    candidates: list[Path] = []
    if source_dir and source_dir.exists():
        candidates.extend(sorted(source_dir.glob("*.JPG")))
        candidates.extend(sorted(source_dir.glob("*.jpg")))
        candidates.extend(sorted(source_dir.glob("*.JPEG")))
        candidates.extend(sorted(source_dir.glob("*.jpeg")))
    if not candidates:
        images_dir = project_dir / "images"
        candidates.extend(sorted(images_dir.glob("*.JPG")))
        candidates.extend(sorted(images_dir.glob("*.jpg")))
        candidates.extend(sorted(images_dir.glob("*.JPEG")))
        candidates.extend(sorted(images_dir.glob("*.jpeg")))
    if not candidates:
        raise ValueError(f"Fant ingen bilder for å utlede dato i {project_dir}")

    metadata = run_exiftool_json("-DateTimeOriginal", "-CreateDate", *[str(path) for path in candidates])
    timestamps: list[str] = []
    for item in metadata:
        timestamp = item.get("DateTimeOriginal") or item.get("CreateDate")
        if isinstance(timestamp, str) and len(timestamp) >= 10:
            timestamps.append(timestamp[:10].replace(":", "-"))
    if not timestamps:
        raise ValueError(f"Fant ingen EXIF-dato for {project_dir}")
    return min(timestamps)


def build_overlay(preview_builder: Path, input_tif: Path, output_image: Path, output_metadata: Path, label: str) -> dict[str, Any]:
    result = subprocess.run(
        [str(preview_builder), str(input_tif), str(output_image), str(output_metadata), label],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def load_tile_manifest(output_dir: Path, asset_basename: str) -> dict[str, Any] | None:
    manifest_path = output_dir / f"{asset_basename}-tiles" / "manifest.json"
    if not manifest_path.exists():
        return None

    parsed = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(parsed, dict):
        raise ValueError(f"{manifest_path} inneholder ikke et JSON-objekt.")

    required = {"format", "minZoom", "maxZoom", "maxNativeZoom", "tileSize"}
    missing = [key for key in required if key not in parsed]
    if missing:
        raise ValueError(f"{manifest_path} mangler påkrevde felt: {', '.join(missing)}")
    return parsed


def tile_layer_from_manifest(tile_manifest: dict[str, Any], asset_basename: str) -> dict[str, Any]:
    tile_format = str(tile_manifest["format"]).lstrip(".")
    source_kind = str(tile_manifest.get("sourceKind") or "unknown")
    if source_kind not in {"canonical", "preview"}:
        source_kind = "unknown"
    quality_scale_raw = tile_manifest.get("qualityScale")
    quality_scale = quality_scale_raw if isinstance(quality_scale_raw, (int, float)) else None
    return {
        "urlTemplate": f"dev-overlays/{asset_basename}-tiles/{{z}}/{{x}}/{{y}}.{tile_format}",
        "minZoom": int(tile_manifest["minZoom"]),
        "maxZoom": int(tile_manifest["maxZoom"]),
        "maxNativeZoom": int(tile_manifest["maxNativeZoom"]),
        "tileSize": int(tile_manifest["tileSize"]),
        "sourceKind": source_kind,
        "sourceWidthPx": int(tile_manifest.get("sourceWidthPx") or 0),
        "sourceHeightPx": int(tile_manifest.get("sourceHeightPx") or 0),
        "canonicalWidthPx": int(tile_manifest.get("canonicalWidthPx") or 0),
        "canonicalHeightPx": int(tile_manifest.get("canonicalHeightPx") or 0),
        "tileCount": int(tile_manifest.get("tileCount") or 0),
        "qualityScale": quality_scale,
    }


def write_ts_manifest(output_path: Path, overlays: list[dict[str, Any]]) -> None:
    lines = [
        "export interface OrthophotoTileLayerDefinition {",
        "  urlTemplate: string;",
        "  minZoom: number;",
        "  maxZoom: number;",
        "  maxNativeZoom: number;",
        "  tileSize: number;",
        '  sourceKind: "canonical" | "preview" | "unknown";',
        "  sourceWidthPx: number;",
        "  sourceHeightPx: number;",
        "  canonicalWidthPx: number;",
        "  canonicalHeightPx: number;",
        "  tileCount: number;",
        "  qualityScale?: number | null;",
        "}",
        "",
        "export interface OrthophotoOverlayDefinition {",
        "  id: string;",
        "  label: string;",
        "  propertyReference: string;",
        "  imageUrl: string;",
        "  capturedDate: string;",
        "  bounds: {",
        "    south: number;",
        "    west: number;",
        "    north: number;",
        "    east: number;",
        "  };",
        "  opacity?: number;",
        "  tileLayer?: OrthophotoTileLayerDefinition;",
        "}",
        "",
        "// Generert av scripts/sync-orthophoto-overlays.py",
        "export const DEV_ORTHOPHOTO_OVERLAYS: OrthophotoOverlayDefinition[] = [",
    ]

    for overlay in overlays:
        bounds = overlay["bounds"]
        lines.extend(
            [
                "  {",
                f'    id: "{overlay["id"]}",',
                f'    label: "{overlay["label"]}",',
                f'    propertyReference: "{overlay["propertyReference"]}",',
                f'    imageUrl: `${{import.meta.env.BASE_URL}}dev-overlays/{overlay["assetFile"]}`,',
                f'    capturedDate: "{overlay["capturedDate"]}",',
                "    bounds: {",
                f'      south: {bounds["south"]},',
                f'      west: {bounds["west"]},',
                f'      north: {bounds["north"]},',
                f'      east: {bounds["east"]},',
                "    },",
                f'    opacity: {overlay["opacity"]},',
            ]
        )
        tile_layer = overlay.get("tileLayer")
        if isinstance(tile_layer, dict):
            quality_scale = tile_layer.get("qualityScale")
            quality_scale_literal = "null" if quality_scale is None else str(quality_scale)
            lines.extend(
                [
                    "    tileLayer: {",
                    f'      urlTemplate: `${{import.meta.env.BASE_URL}}{tile_layer["urlTemplate"]}`,',
                    f'      minZoom: {tile_layer["minZoom"]},',
                    f'      maxZoom: {tile_layer["maxZoom"]},',
                    f'      maxNativeZoom: {tile_layer["maxNativeZoom"]},',
                    f'      tileSize: {tile_layer["tileSize"]},',
                    f'      sourceKind: "{tile_layer["sourceKind"]}",',
                    f'      sourceWidthPx: {tile_layer["sourceWidthPx"]},',
                    f'      sourceHeightPx: {tile_layer["sourceHeightPx"]},',
                    f'      canonicalWidthPx: {tile_layer["canonicalWidthPx"]},',
                    f'      canonicalHeightPx: {tile_layer["canonicalHeightPx"]},',
                    f'      tileCount: {tile_layer["tileCount"]},',
                    f"      qualityScale: {quality_scale_literal},",
                    "    },",
                ]
            )
        lines.append("  },")

    lines.append("];")
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Bygg web-optimaliserte ortofoto-overlays fra ferdige ODM-prosjekter.")
    parser.add_argument("--processing-root", default=str(repo_root / ".processing" / "odm"))
    parser.add_argument("--output-dir", default=str(repo_root / "apps" / "web-app" / "public" / "dev-overlays"))
    parser.add_argument("--manifest-ts", default=str(repo_root / "apps" / "web-app" / "src" / "lib" / "orthophoto-overlays.ts"))
    parser.add_argument("--property-reference", default="4003-70/17/0")
    parser.add_argument("--opacity", type=float, default=0.82)
    parser.add_argument("--project", action="append", dest="projects")
    args = parser.parse_args()

    processing_root = Path(args.processing_root).expanduser().resolve()
    output_dir = Path(args.output_dir).expanduser().resolve()
    manifest_ts = Path(args.manifest_ts).expanduser().resolve()
    builder = (repo_root / "scripts" / "build-orthophoto-overlay.py").resolve()

    projects = find_projects(processing_root)
    if args.projects:
        allowed = set(args.projects)
        projects = [project for project in projects if project.project_name in allowed]

    if not projects:
        raise SystemExit("Fant ingen ferdige ODM-prosjekter med ortofoto.")

    output_dir.mkdir(parents=True, exist_ok=True)
    overlays: list[dict[str, Any]] = []

    for project in projects:
        asset_basename = f"{project.project_name}-orthophoto"
        output_image = output_dir / f"{asset_basename}.webp"
        output_metadata = output_dir / f"{asset_basename}.json"
        preview_metadata = build_overlay(builder, project.orthophoto_tif, output_image, output_metadata, project.label)
        captured_date = find_captured_date(project.source_dir, project.orthophoto_tif.parent.parent)
        latlng = preview_metadata["latlng_bounds"]
        overlay = {
            "id": asset_basename,
            "label": project.label,
            "propertyReference": args.property_reference,
            "assetFile": output_image.name,
            "capturedDate": captured_date,
            "year": captured_date[:4],
            "season": season_from_date(captured_date),
            "bounds": {
                "south": latlng["south"],
                "west": latlng["west"],
                "north": latlng["north"],
                "east": latlng["east"],
            },
            "opacity": args.opacity,
        }
        tile_manifest = load_tile_manifest(output_dir, asset_basename)
        if tile_manifest is not None:
            overlay["tileLayer"] = tile_layer_from_manifest(tile_manifest, asset_basename)
        full_metadata = {
            **preview_metadata,
            "capturedDate": captured_date,
            "year": captured_date[:4],
            "season": season_from_date(captured_date),
            "overlay": overlay,
            "source_dir": str(project.source_dir) if project.source_dir else None,
            "project_name": project.project_name,
        }
        output_metadata.write_text(json.dumps(full_metadata, indent=2), encoding="utf-8")
        overlays.append(overlay)

    write_ts_manifest(manifest_ts, overlays)
    print(json.dumps({"count": len(overlays), "projects": [overlay["id"] for overlay in overlays]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
