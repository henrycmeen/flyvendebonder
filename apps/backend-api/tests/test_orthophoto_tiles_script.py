from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image


def load_script(script_name: str, module_name: str):
    repo_root = Path(__file__).resolve().parents[3]
    script_path = repo_root / "scripts" / script_name
    spec = importlib.util.spec_from_file_location(module_name, script_path)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_tile_script():
    return load_script("build-orthophoto-tiles.py", "build_orthophoto_tiles")


def test_build_orthophoto_tiles_writes_xyz_tiles_and_manifest(tmp_path: Path) -> None:
    module = load_tile_script()
    source_image = tmp_path / "source.webp"
    metadata_path = tmp_path / "source.json"
    output_dir = tmp_path / "tiles"

    image = Image.new("RGBA", (512, 512), (20, 110, 80, 255))
    image.save(source_image, format="WEBP", quality=80)
    metadata_path.write_text(
        json.dumps(
            {
                "width_px": 512,
                "height_px": 512,
                "preview_width_px": 512,
                "preview_height_px": 512,
                "latlng_bounds": {
                    "south": 59.133,
                    "west": 9.675,
                    "north": 59.14,
                    "east": 9.683,
                },
                "overlay": {"id": "test-orthophoto"},
            }
        ),
        encoding="utf-8",
    )

    manifest = module.build_tiles(
        source_image,
        metadata_path,
        output_dir,
        min_zoom=14,
        max_zoom=14,
        overlay_id="test-orthophoto",
    )

    written_tiles = list(output_dir.glob("14/*/*.webp"))
    assert written_tiles
    assert manifest["overlayId"] == "test-orthophoto"
    assert manifest["sourceKind"] == "preview"
    assert manifest["tileCount"] == len(written_tiles)
    assert (output_dir / "manifest.json").exists()


def test_sync_orthophoto_overlays_writes_tile_layer_definition(tmp_path: Path) -> None:
    module = load_script("sync-orthophoto-overlays.py", "sync_orthophoto_overlays")
    output_dir = tmp_path / "dev-overlays"
    tiles_dir = output_dir / "jorde-9-orthophoto-tiles"
    tiles_dir.mkdir(parents=True)
    (tiles_dir / "manifest.json").write_text(
        json.dumps(
            {
                "format": "webp",
                "minZoom": 14,
                "maxZoom": 19,
                "maxNativeZoom": 19,
                "tileSize": 256,
                "sourceKind": "preview",
                "sourceWidthPx": 2400,
                "sourceHeightPx": 4426,
                "canonicalWidthPx": 14324,
                "canonicalHeightPx": 26416,
                "tileCount": 300,
                "qualityScale": 5.97,
            }
        ),
        encoding="utf-8",
    )

    tile_manifest = module.load_tile_manifest(output_dir, "jorde-9-orthophoto")
    assert tile_manifest is not None
    tile_layer = module.tile_layer_from_manifest(tile_manifest, "jorde-9-orthophoto")
    manifest_ts = tmp_path / "orthophoto-overlays.ts"
    module.write_ts_manifest(
        manifest_ts,
        [
            {
                "id": "jorde-9-orthophoto",
                "label": "Jorde 9 ortofoto",
                "propertyReference": "4003-70/17/0",
                "assetFile": "jorde-9-orthophoto.webp",
                "capturedDate": "2026-04-01",
                "bounds": {"south": 59.1, "west": 9.6, "north": 59.2, "east": 9.7},
                "opacity": 0.82,
                "tileLayer": tile_layer,
            }
        ],
    )

    generated = manifest_ts.read_text(encoding="utf-8")
    assert "export interface OrthophotoTileLayerDefinition" in generated
    assert "tileLayer: {" in generated
    assert "jorde-9-orthophoto-tiles/{z}/{x}/{y}.webp" in generated
    assert 'sourceKind: "preview"' in generated
    assert "qualityScale: 5.97" in generated
