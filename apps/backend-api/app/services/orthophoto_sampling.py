from __future__ import annotations

import json
import math
from pathlib import Path
from statistics import median
from typing import Any

import rasterio
from rasterio.enums import ColorInterp
from rasterio.errors import RasterioError
from rasterio.warp import transform
from rasterio.windows import Window
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


def _resolve_source(metadata: dict[str, Any], overlay_root: Path, *, allow_preview: bool) -> tuple[Path, str]:
    source_file = _as_str(metadata.get("source_file"))
    if source_file:
        source_path = Path(source_file).expanduser()
        if source_path.is_file():
            return source_path, "canonical"

    if not allow_preview:
        raise OrthophotoSourceUnavailable("Kanonisk GeoTIFF er ikke tilgjengelig. Forhåndsvisning krever eksplisitt valg.")

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
    # Pixel coordinates refer to pixel corners; floor selects the containing pixel.
    center_x = math.floor(center["x"])
    center_y = math.floor(center["y"])
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


def _sample_canonical(source_path: Path, lat: float, lng: float, sample_size_px: int) -> tuple:
    """Read a native-resolution RGB window using the raster's own CRS and masks."""
    try:
        with rasterio.open(source_path) as dataset:
            if (dataset.crs is None or dataset.transform.is_identity
                    or dataset.transform.determinant == 0):
                raise OrthophotoSourceUnavailable("Kanonisk raster mangler CRS eller geotransform.")
            bands = [dataset.colorinterp.index(color) + 1 for color in
                     (ColorInterp.red, ColorInterp.green, ColorInterp.blue)
                     if color in dataset.colorinterp]
            if len(bands) != 3 or any(dataset.dtypes[index - 1] != "uint8" for index in bands):
                raise OrthophotoSourceUnavailable("Fargeprøver krever eksplisitte RGB-bånd med 8-bit verdier.")
            xs, ys = transform("EPSG:4326", dataset.crs, [lng], [lat])
            col, row = ~dataset.transform @ (xs[0], ys[0])
            if not math.isfinite(col) or not math.isfinite(row):
                raise OrthophotoPointOutsideBounds("Punktet kan ikke projiseres til ortofotoets raster.")
            if not (0 <= col < dataset.width and 0 <= row < dataset.height):
                raise OrthophotoPointOutsideBounds("Punktet ligger utenfor ortofotoets raster.")
            image_pixel = {"x": _round(col), "y": _round(row),
                           "ratio_x": _round(col / dataset.width, 6),
                           "ratio_y": _round(row / dataset.height, 6)}
            # Do not round coordinates before choosing the containing pixel.
            left, top, right, bottom, clipped = _crop_box(
                {"x": col, "y": row}, dataset.width, dataset.height, sample_size_px)
            window = Window(left, top, right - left, bottom - top)
            rgb = dataset.read(bands, window=window)
            masks = dataset.read_masks(bands, window=window)
            alpha_band = next((index + 1 for index, color in enumerate(dataset.colorinterp)
                               if color == ColorInterp.alpha), None)
            alpha = dataset.read(alpha_band, window=window) if alpha_band else None
            pixels = []
            for y in range(bottom - top):
                for x in range(right - left):
                    valid = all(masks[band, y, x] > 0 for band in range(3))
                    opacity = int(alpha[y, x]) if alpha is not None else 255
                    pixels.append(tuple(int(rgb[band, y, x]) for band in range(3)) +
                                  (opacity if valid else 0,))
            affine = dataset.transform
            gsd = None
            if dataset.crs.is_projected and dataset.crs.linear_units == "metre":
                gsd = {"x": _round(math.hypot(affine.a, affine.d), 4),
                       "y": _round(math.hypot(affine.b, affine.e), 4)}
            provenance = {"crs": dataset.crs.to_string(),
                          "transform": list(affine)[:6],
                          "coordinate_mapping": "crs_affine",
                          "quantitative_eligible": True,
                          "fallback_reason": None,
                          "nodata_policy": "rgb_band_masks_and_alpha",
                          "nodata_values": [_as_float(value) for value in dataset.nodatavals],
                          "gsd_m_per_px": gsd}
            return dataset.width, dataset.height, image_pixel, left, top, right, bottom, clipped, pixels, provenance
    except RasterioError as exc:
        raise OrthophotoSourceUnavailable("Kanonisk GeoTIFF kan ikke leses eller projiseres.") from exc


def sample_orthophoto_color(
    overlay_id: str,
    *,
    lat: float,
    lng: float,
    sample_size_px: int = ORTHOPHOTO_SAMPLE_SIZE_PX,
    overlay_root: Path | None = None,
    allow_preview: bool = False,
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
    if not math.isfinite(lat) or not math.isfinite(lng) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise OrthophotoSamplingError("Punktet må ha gyldige WGS84-koordinater.")
    source_path, source_kind = _resolve_source(metadata, root, allow_preview=allow_preview)
    if source_kind == "canonical":
        (image_width, image_height, image_pixel, left, top, right, bottom,
         clipped, pixels, provenance) = _sample_canonical(source_path, lat, lng, sample_size_px)
    else:
        bounds = _resolve_bounds(metadata)
        try:
            with Image.open(source_path) as image:
                image_width, image_height = image.size
                image_pixel = _image_pixel(lat, lng, bounds, image_width, image_height)
                left, top, right, bottom, clipped = _crop_box(image_pixel, image_width, image_height, sample_size_px)
                pixels = list(image.crop((left, top, right, bottom)).convert("RGBA").getdata())
        except (UnidentifiedImageError, OSError) as exc:
            raise OrthophotoSourceUnavailable("Forhåndsvisning kan ikke leses.") from exc
        provenance = {"crs": None, "transform": None,
                      "coordinate_mapping": "approximate_wgs84_bounds",
                      "quantitative_eligible": False,
                      "fallback_reason": "canonical_source_unavailable",
                      "nodata_policy": "preview_alpha_only", "nodata_values": [],
                      "gsd_m_per_px": None}
    analysis = _analyze_pixels(pixels, right - left, bottom - top, sample_size_px, clipped)
    if source_kind == "preview":
        analysis["quality_flags"].append("approximate_preview_not_quantitative")
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
            "width_px": image_width,
            "height_px": image_height,
            "canonical_width_px": image_width if source_kind == "canonical" else int(_as_float(metadata.get("width_px")) or image_width),
            "canonical_height_px": image_height if source_kind == "canonical" else int(_as_float(metadata.get("height_px")) or image_height),
            **provenance,
        },
        "point": {"lat": lat, "lng": lng},
        "image_pixel": image_pixel,
        "analysis": analysis,
    }
