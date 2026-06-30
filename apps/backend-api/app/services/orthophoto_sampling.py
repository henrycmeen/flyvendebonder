from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import median
from typing import Any

from PIL import Image, UnidentifiedImageError

from ..config import DEPLOYED_ORTHOPHOTO_OVERLAY_ROOT, LOCAL_ORTHOPHOTO_OVERLAY_ROOT, get_settings

ORTHOPHOTO_SAMPLE_SIZE_PX = 21
ALPHA_VALID_THRESHOLD = 16
EPSILON = 0.0001


class OrthophotoSamplingError(Exception):
    """Base class for expected orthophoto sampling failures."""


class OrthophotoNotFound(OrthophotoSamplingError):
    pass


class OrthophotoPointOutsideBounds(OrthophotoSamplingError):
    pass


class OrthophotoSourceUnavailable(OrthophotoSamplingError):
    pass


class OrthophotoNoData(OrthophotoSamplingError):
    pass


def _round(value: float, decimals: int = 3) -> float:
    if not math.isfinite(value):
        return 0.0
    return round(value, decimals)


def _safe_ratio(numerator: float, denominator: float) -> float:
    if abs(denominator) < EPSILON:
        return 0.0
    value = numerator / denominator
    return value if math.isfinite(value) else 0.0


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _light_assessment(brightness: float) -> str:
    if brightness < 0.16:
        return "Mørkt utsnitt"
    if brightness < 0.3:
        return "Lavt lys / mulig skygge"
    if brightness > 0.88:
        return "Svært lyst / mulig overeksponering"
    if brightness > 0.72:
        return "Lyst utsnitt"
    return "Balansert lys"


def _as_record(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _as_float(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _as_str(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _metadata_path(overlay_id: str, overlay_root: Path) -> Path:
    safe_id = overlay_id.strip()
    if not safe_id or "/" in safe_id or "\\" in safe_id or safe_id in {".", ".."}:
        raise OrthophotoNotFound("Ukjent ortofoto.")
    return overlay_root / f"{safe_id}.json"


def _load_metadata(overlay_id: str, overlay_root: Path) -> dict[str, Any]:
    path = _metadata_path(overlay_id, overlay_root)
    if not path.is_file():
        raise OrthophotoNotFound("Ukjent ortofoto.")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise OrthophotoSourceUnavailable("Ortofoto-metadata kan ikke leses.") from exc


def _candidate_overlay_roots(primary_root: Path, include_defaults: bool) -> list[Path]:
    roots = [primary_root]
    if include_defaults:
        for fallback_root in (DEPLOYED_ORTHOPHOTO_OVERLAY_ROOT, LOCAL_ORTHOPHOTO_OVERLAY_ROOT):
            if fallback_root not in roots:
                roots.append(fallback_root)
    return roots


def _load_metadata_from_roots(overlay_id: str, roots: list[Path]) -> tuple[dict[str, Any], Path]:
    for root in roots:
        try:
            return _load_metadata(overlay_id, root), root
        except OrthophotoNotFound:
            continue
    raise OrthophotoNotFound("Ukjent ortofoto.")


def _resolve_bounds(metadata: dict[str, Any]) -> dict[str, float]:
    overlay = _as_record(metadata.get("overlay"))
    raw_bounds = _as_record(overlay.get("bounds") or metadata.get("latlng_bounds"))
    bounds = {key: _as_float(raw_bounds.get(key)) for key in ("south", "west", "north", "east")}
    if not all(value is not None for value in bounds.values()):
        raise OrthophotoSourceUnavailable("Ortofoto mangler gyldige geografiske bounds.")
    south = bounds["south"]
    west = bounds["west"]
    north = bounds["north"]
    east = bounds["east"]
    if south is None or west is None or north is None or east is None or south >= north or west >= east:
        raise OrthophotoSourceUnavailable("Ortofoto mangler gyldige geografiske bounds.")
    return {"south": south, "west": west, "north": north, "east": east}


def _resolve_source(metadata: dict[str, Any], overlay_root: Path) -> tuple[Path, str]:
    source_file = _as_str(metadata.get("source_file"))
    if source_file:
        source_path = Path(source_file).expanduser()
        if source_path.is_file():
            return source_path, "canonical"

    overlay = _as_record(metadata.get("overlay"))
    asset_file = _as_str(overlay.get("assetFile"))
    if asset_file:
        preview_path = overlay_root / asset_file
        if preview_path.is_file():
            return preview_path, "preview"

    preview_file = _as_str(metadata.get("preview_file"))
    if preview_file:
        preview_path = Path(preview_file).expanduser()
        if preview_path.is_file():
            return preview_path, "preview"
        preview_path = overlay_root / Path(preview_file).name
        if preview_path.is_file():
            return preview_path, "preview"

    raise OrthophotoSourceUnavailable("Ortofoto-raster er ikke tilgjengelig.")


def _source_dimensions(metadata: dict[str, Any], source_kind: str, image_width: int, image_height: int) -> tuple[int, int]:
    if source_kind == "canonical":
        width = int(_as_float(metadata.get("width_px")) or image_width)
        height = int(_as_float(metadata.get("height_px")) or image_height)
        return width, height
    width = int(_as_float(metadata.get("preview_width_px")) or image_width)
    height = int(_as_float(metadata.get("preview_height_px")) or image_height)
    return width, height


def _gsd_m_per_px(metadata: dict[str, Any], width_px: int, height_px: int) -> dict[str, float] | None:
    utm_bounds = _as_record(metadata.get("utm_bounds"))
    westing = _as_float(utm_bounds.get("westing"))
    easting = _as_float(utm_bounds.get("easting"))
    southing = _as_float(utm_bounds.get("southing"))
    northing = _as_float(utm_bounds.get("northing"))
    if None in {westing, easting, southing, northing} or width_px <= 0 or height_px <= 0:
        return None
    assert westing is not None and easting is not None and southing is not None and northing is not None
    return {
        "x": _round(abs(easting - westing) / width_px, 4),
        "y": _round(abs(northing - southing) / height_px, 4),
    }


def _image_pixel(lat: float, lng: float, bounds: dict[str, float], image_width: int, image_height: int) -> dict[str, float]:
    if lat < bounds["south"] or lat > bounds["north"] or lng < bounds["west"] or lng > bounds["east"]:
        raise OrthophotoPointOutsideBounds("Punktet ligger utenfor ortofotoets bounds.")
    ratio_x = (lng - bounds["west"]) / (bounds["east"] - bounds["west"])
    ratio_y = (bounds["north"] - lat) / (bounds["north"] - bounds["south"])
    return {
        "x": _round(ratio_x * image_width, 3),
        "y": _round(ratio_y * image_height, 3),
        "ratio_x": _round(ratio_x, 6),
        "ratio_y": _round(ratio_y, 6),
    }


def _crop_box(center: dict[str, float], image_width: int, image_height: int, sample_size_px: int) -> tuple[int, int, int, int, bool]:
    half = sample_size_px // 2
    center_x = round(center["x"])
    center_y = round(center["y"])
    requested_left = center_x - half
    requested_top = center_y - half
    requested_right = requested_left + sample_size_px
    requested_bottom = requested_top + sample_size_px
    left = max(0, requested_left)
    top = max(0, requested_top)
    right = min(image_width, requested_right)
    bottom = min(image_height, requested_bottom)
    clipped = left != requested_left or top != requested_top or right != requested_right or bottom != requested_bottom
    if right <= left or bottom <= top:
        raise OrthophotoPointOutsideBounds("Punktet ligger utenfor ortofotoets raster.")
    return left, top, right, bottom, clipped


def _quality_flags(
    *,
    clipped: bool,
    requested_pixels: int,
    valid_pixels: int,
    transparent_pixels: int,
    dark_pixels: int,
    overexposed_pixels: int,
    brightness: float,
    indices: dict[str, float],
) -> list[str]:
    flags: list[str] = []
    sampled_pixels = max(1, valid_pixels + transparent_pixels)
    if clipped:
        flags.append("edge_clipped")
    if valid_pixels < requested_pixels * 0.55:
        flags.append("low_valid_pixels")
    if transparent_pixels > sampled_pixels * 0.15:
        flags.append("transparent_or_nodata")
    if brightness < 0.18:
        flags.append("dark_sample")
    if valid_pixels > 0 and dark_pixels > valid_pixels * 0.22:
        flags.append("shadow_risk")
    if brightness > 0.74:
        flags.append("bright_sample")
    if valid_pixels > 0 and overexposed_pixels > valid_pixels * 0.08:
        flags.append("overexposed_pixels")
    if indices["exg"] < 0.05 and indices["gli"] < 0.04:
        flags.append("possible_soil_or_background")
    return flags


def _analyze_pixels(pixels: list[tuple[int, int, int, int]], width: int, height: int, sample_size_px: int, clipped: bool) -> dict[str, Any]:
    r_values: list[float] = []
    g_values: list[float] = []
    b_values: list[float] = []
    brightness_values: list[float] = []
    exg_values: list[float] = []
    vari_values: list[float] = []
    ngrdi_values: list[float] = []
    gli_values: list[float] = []
    ndyi_values: list[float] = []
    dark_pixels = 0
    overexposed_pixels = 0
    transparent_pixels = 0

    for r_raw, g_raw, b_raw, alpha in pixels:
        if alpha < ALPHA_VALID_THRESHOLD:
            transparent_pixels += 1
            continue

        r = r_raw / 255
        g = g_raw / 255
        b = b_raw / 255
        brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b

        r_values.append(float(r_raw))
        g_values.append(float(g_raw))
        b_values.append(float(b_raw))
        brightness_values.append(brightness)
        exg_values.append(2 * g - r - b)
        vari_values.append(_safe_ratio(g - r, g + r - b))
        ngrdi_values.append(_safe_ratio(g - r, g + r))
        gli_values.append(_safe_ratio(2 * g - r - b, 2 * g + r + b))
        ndyi_values.append(_safe_ratio(g - b, g + b))

        if brightness < 0.12:
            dark_pixels += 1
        if r_raw >= 248 or g_raw >= 248 or b_raw >= 248:
            overexposed_pixels += 1

    valid_pixels = len(r_values)
    if valid_pixels == 0:
        raise OrthophotoNoData("Prøveflaten traff bare transparente/no-data piksler.")

    requested_pixels = sample_size_px * sample_size_px
    indices = {
        "exg": _round(_mean(exg_values), 4),
        "vari": _round(_mean(vari_values), 4),
        "ngrdi": _round(_mean(ngrdi_values), 4),
        "gli": _round(_mean(gli_values), 4),
        "ndyi": _round(_mean(ndyi_values), 4),
    }
    brightness = _round(_mean(brightness_values), 3)

    return {
        "requested_size_px": sample_size_px,
        "sampled_width_px": width,
        "sampled_height_px": height,
        "requested_pixels": requested_pixels,
        "sampled_pixels": width * height,
        "valid_pixels": valid_pixels,
        "clipped": clipped,
        "mean_rgb": {
            "r": _round(_mean(r_values), 1),
            "g": _round(_mean(g_values), 1),
            "b": _round(_mean(b_values), 1),
        },
        "median_rgb": {
            "r": _round(float(median(r_values)), 1),
            "g": _round(float(median(g_values)), 1),
            "b": _round(float(median(b_values)), 1),
        },
        "brightness": brightness,
        "light_assessment": _light_assessment(brightness),
        "indices": indices,
        "quality_flags": _quality_flags(
            clipped=clipped,
            requested_pixels=requested_pixels,
            valid_pixels=valid_pixels,
            transparent_pixels=transparent_pixels,
            dark_pixels=dark_pixels,
            overexposed_pixels=overexposed_pixels,
            brightness=brightness,
            indices=indices,
        ),
    }


def sample_orthophoto_color(
    overlay_id: str,
    *,
    lat: float,
    lng: float,
    sample_size_px: int = ORTHOPHOTO_SAMPLE_SIZE_PX,
    overlay_root: Path | None = None,
) -> dict[str, Any]:
    if sample_size_px < 3 or sample_size_px > 101:
        raise OrthophotoSamplingError("Prøveflaten må være mellom 3 og 101 piksler.")
    if sample_size_px % 2 == 0:
        sample_size_px += 1

    root = overlay_root or get_settings().orthophoto_overlay_root
    metadata, root = _load_metadata_from_roots(
        overlay_id,
        _candidate_overlay_roots(root, include_defaults=overlay_root is None),
    )
    overlay = _as_record(metadata.get("overlay"))
    bounds = _resolve_bounds(metadata)
    source_path, source_kind = _resolve_source(metadata, root)

    try:
        with Image.open(source_path) as image:
            image_width, image_height = image.size
            image_pixel = _image_pixel(lat, lng, bounds, image_width, image_height)
            left, top, right, bottom, clipped = _crop_box(image_pixel, image_width, image_height, sample_size_px)
            crop = image.crop((left, top, right, bottom)).convert("RGBA")
            pixels = list(crop.getdata())
    except UnidentifiedImageError as exc:
        raise OrthophotoSourceUnavailable("Ortofoto-raster kan ikke leses.") from exc
    except OSError as exc:
        raise OrthophotoSourceUnavailable("Ortofoto-raster kan ikke åpnes.") from exc

    source_width_px, source_height_px = _source_dimensions(metadata, source_kind, image_width, image_height)
    return {
        "overlay": {
            "id": overlay.get("id") or overlay_id,
            "label": overlay.get("label") or overlay_id,
            "captured_date": overlay.get("capturedDate") or metadata.get("capturedDate"),
            "property_reference": overlay.get("propertyReference"),
        },
        "source": {
            "kind": source_kind,
            "path_basename": source_path.name,
            "width_px": source_width_px,
            "height_px": source_height_px,
            "canonical_width_px": int(_as_float(metadata.get("width_px")) or source_width_px),
            "canonical_height_px": int(_as_float(metadata.get("height_px")) or source_height_px),
            "gsd_m_per_px": _gsd_m_per_px(metadata, source_width_px, source_height_px),
        },
        "point": {"lat": lat, "lng": lng},
        "image_pixel": image_pixel,
        "analysis": _analyze_pixels(pixels, right - left, bottom - top, sample_size_px, clipped),
    }
