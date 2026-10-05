from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image
import pytest


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


def test_sync_orthophoto_overlays_writes_tile_layer_definition(tmp_path: Path, monkeypatch) -> None:
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


    # Normal CLI regeneration must retain a standalone export and never rebuild its ID.
    standalone_id = "august-r13-5cm-orthophoto"
    standalone_overlay = {
        "id": standalone_id, "label": "Augusteksport", "propertyReference": "4003-70/17/0",
        "assetFile": f"{standalone_id}.webp", "capturedDate": "2026-08-02",
        "bounds": {"south": 59.1, "west": 9.6, "north": 59.2, "east": 9.7}, "opacity": 0.82,
        "limitations": ["Transparente hull"],
        "canonicalSource": {"sha256": "a" * 64, "crs": "EPSG:32632", "widthPx": 20358, "heightPx": 21862},
    }
    standalone_metadata = output_dir / f"{standalone_id}.json"
    original_metadata = json.dumps({"provenance": {"registration_status": "v3_workbench_draft"},
                                    "source_sha256": "a" * 64, "overlay": standalone_overlay})
    standalone_metadata.write_text(original_metadata)
    standalone_asset = output_dir / standalone_overlay["assetFile"]
    Image.new("RGBA", (3, 3), (20, 110, 80, 128)).save(standalone_asset, format="WEBP")
    original_asset = standalone_asset.read_bytes()
    processing_root = tmp_path / "processing"
    for project in ("jorde-9", "august-r13-5cm"):
        tif = processing_root / project / "odm_orthophoto" / "odm_orthophoto.tif"
        tif.parent.mkdir(parents=True)
        tif.touch()
    built_sources = []
    def build_overlay(_builder, source, _image, _metadata, _label):
        built_sources.append(source)
        return {"latlng_bounds": {"south": 59.1, "west": 9.6, "north": 59.2, "east": 9.7}}
    monkeypatch.setattr(module, "build_overlay", build_overlay)
    monkeypatch.setattr(module, "find_captured_date", lambda *_args: "2026-04-01")
    monkeypatch.setattr(sys, "argv", ["sync-orthophoto-overlays.py", "--processing-root", str(processing_root),
                                     "--output-dir", str(output_dir), "--manifest-ts", str(manifest_ts)])
    assert module.main() == 0
    regenerated = manifest_ts.read_text()
    assert regenerated.count(f'id: "{standalone_id}"') == 1
    assert 'id: "jorde-9-orthophoto"' in regenerated
    assert "tileLayer: {" in regenerated
    assert 'limitations: ["Transparente hull"]' in regenerated
    assert 'sha256: "' + "a" * 64 + '"' in regenerated
    assert len(built_sources) == 1 and built_sources[0].parent.parent.name == "jorde-9"
    assert standalone_metadata.read_text() == original_metadata
    assert standalone_asset.read_bytes() == original_asset

    standalone_metadata.write_text("{broken registered metadata")
    with pytest.raises(SystemExit, match="august-r13-5cm-orthophoto.json.*Rett filen"):
        module.main()
    assert manifest_ts.read_text() == regenerated
    assert len(built_sources) == 1


    # Invalid standalone serialization or a cross-ID preview collision must fail before any builder writes.
    colliding_asset = output_dir / "jorde-9-orthophoto.webp"
    colliding_asset.write_bytes(b"preserved existing ODM preview")
    for invalid_field, invalid_value, error in (
        ("assetFile", colliding_asset.name, "assetFile"),
        ("opacity", "bad", "opacity"),
        ("tileLayer", {}, "tileLayer"),
    ):
        invalid_metadata = json.loads(original_metadata)
        invalid_metadata["overlay"][invalid_field] = invalid_value
        standalone_metadata.write_text(json.dumps(invalid_metadata))
        files_before = {path.relative_to(output_dir): path.read_bytes()
                        for path in output_dir.rglob("*") if path.is_file()}
        with pytest.raises(SystemExit, match=f"august-r13-5cm-orthophoto.json.*{error}"):
            module.main()
        assert manifest_ts.read_text() == regenerated
        assert len(built_sources) == 1
        assert {path.relative_to(output_dir): path.read_bytes()
                for path in output_dir.rglob("*") if path.is_file()} == files_before
