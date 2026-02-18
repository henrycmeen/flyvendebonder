from __future__ import annotations

import json
import logging
import re
import math
import shutil
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image

logger = logging.getLogger(__name__)


FIELD_ALIASES = {
    "DateTimeOriginal": "date_time_original",
    "DateTime": "date_time",
    "ImageWidth": "image_width_px",
    "ExifImageWidth": "image_width_px",
    "PixelXDimension": "image_width_px",
    "ImageHeight": "image_height_px",
    "ExifImageHeight": "image_height_px",
    "PixelYDimension": "image_height_px",
    "FocalLength": "focal_length_mm",
    "FocalLengthIn35mmFormat": "focal_length_35mm_format_mm",
    "FNumber": "f_number",
    "SensorWidth": "sensor_width_mm",
    "FocalPlaneXResolution": "focal_plane_x_resolution",
    "FocalPlaneYResolution": "focal_plane_y_resolution",
    "FocalPlaneResolutionUnit": "focal_plane_resolution_unit",
    "XResolution": "x_resolution",
    "YResolution": "y_resolution",
    "ResolutionUnit": "resolution_unit",
    "GPSLatitude": "gps_latitude",
    "GPSLongitude": "gps_longitude",
    "GPSAltitude": "altitude_m",
    "Altitude": "altitude_m",
    "FlightYawDegree": "flight_yaw_degree",
    "FlightPitchDegree": "flight_pitch_degree",
    "GimbalPitchDegree": "gimbal_pitch_degree",
    "GimbalYawDegree": "gimbal_yaw_degree",
    "Compass": "compass",
    "CameraPitch": "camera_pitch_degree",
    "CameraYaw": "camera_yaw_degree",
    "Heading": "heading_deg",
    "heading": "heading_deg",
    "GPSImgDirection": "heading_deg",
    "Pitch": "camera_pitch_degree",
}


EXIF_DATETIME_KEYS = (36867, 306)
EXIF_GPS_INFO_TAGS = (34853,)
EXIF_GPS_ALTITUDE_TAG = 6
EXIF_GPS_ALTITUDE_REF_TAG = 5
EXIF_GPS_LAT_TAG = 2
EXIF_GPS_LAT_REF_TAG = 1
EXIF_GPS_LNG_TAG = 4
EXIF_GPS_LNG_REF_TAG = 3
EXIF_HEADING_TAG = 17


@dataclass
class ExtractedMetadata:
    source_file: str
    captured_at: datetime | None
    gps_latitude: float | None
    gps_longitude: float | None
    altitude_m: float | None
    heading_deg: float | None
    flight_yaw_degree: float | None
    flight_pitch_degree: float | None
    gimbal_pitch_degree: float | None
    gimbal_yaw_degree: float | None
    compass: float | None
    camera_pitch_degree: float | None
    camera_yaw_degree: float | None
    image_width_px: int | None = None
    image_height_px: int | None = None
    focal_length_mm: float | None = None
    focal_length_35mm_format_mm: float | None = None
    f_number: float | None = None
    focal_plane_x_resolution: float | None = None
    focal_plane_y_resolution: float | None = None
    focal_plane_resolution_unit: float | str | None = None
    x_resolution: float | None = None
    y_resolution: float | None = None
    resolution_unit: float | str | None = None
    source: str = "unknown"
    raw: dict[str, Any] = field(default_factory=dict)
    issues: list[str] = field(default_factory=list)


@dataclass
class OrientationSelection:
    value: float | None
    source: str
    source_detail: str
    candidates: dict[str, float]
    qc_tags: list[str] = field(default_factory=list)


def _heading_delta_deg(angle_a: float, angle_b: float) -> float:
    delta = abs((angle_a - angle_b) % 360.0)
    return min(delta, 360.0 - delta)


def _normalize_heading_degrees(raw_value: float | None) -> float | None:
    if raw_value is None:
        return None

    if not math.isfinite(raw_value):
        return None

    normalized = raw_value % 360.0
    if normalized < 0:
        normalized += 360.0
    return normalized


def _normalize_pitch_degrees(raw_value: float | None) -> tuple[float | None, bool]:
    if raw_value is None:
        return None, False

    if not math.isfinite(raw_value):
        return None, False

    pitch = (raw_value + 180.0) % 360.0 - 180.0
    uncertain = False

    # DJI-lignende verdier dukker tidvis opp som 180+ eller 360-nært.
    # Mapper disse til [-90, 90]-området og merker at konvensjonen er usikker.
    if pitch > 90.0:
        folded = 180.0 - pitch
        if folded >= -90.0:
            pitch = folded
            uncertain = True
    elif pitch < -90.0:
        folded = -180.0 - pitch
        if folded <= 90.0:
            pitch = folded
            uncertain = True

    if pitch < -90.0 or pitch > 90.0:
        return None, False

    return pitch, uncertain


def _serialize_orientation_candidates(candidates: dict[str, float]) -> str:
    if not candidates:
        return ""

    return ",".join(f"{name}={value:.2f}" for name, value in sorted(candidates.items()))


def select_heading_from_metadata(metadata: ExtractedMetadata) -> OrientationSelection:
    candidate_specs = [
        ("flight_yaw", "flight_yaw_degree", "imu"),
        ("gimbal_yaw", "gimbal_yaw_degree", "imu"),
        ("camera_yaw", "camera_yaw_degree", "imu"),
        ("compass", "compass", "gps_course"),
        ("inferred_heading", "heading_deg", "inferred_from_sequence"),
    ]

    candidates: dict[str, float] = {}
    ordered_candidates: list[tuple[str, float]] = []
    qc_tags: list[str] = []

    for candidate_name, field_name, _source in candidate_specs:
        raw = getattr(metadata, field_name, None)
        normalized = _normalize_heading_degrees(_to_float(raw))
        if normalized is None:
            continue
        candidates[candidate_name] = normalized
        ordered_candidates.append((candidate_name, normalized))

    if not ordered_candidates:
        return OrientationSelection(value=None, source="unknown", source_detail="unknown", candidates={}, qc_tags=["qc:missing_heading"])

    source_detail, value = ordered_candidates[0]
    source = {
        "flight_yaw": "imu",
        "gimbal_yaw": "imu",
        "camera_yaw": "imu",
        "compass": "gps_course",
        "inferred_heading": "inferred_from_sequence",
    }[source_detail]

    if source_detail != "flight_yaw":
        qc_tags.append("qc:heading_source_switch")

    if len(ordered_candidates) > 1 and value is not None:
        for _, other in ordered_candidates[1:]:
            if _heading_delta_deg(value, other) > 30.0:
                qc_tags.append("qc:heading_source_conflict")
                break

    # Sorterte kandidater brukes også som UI-debug hvis nødvendig.
    candidates_ordered = {name: candidates[name] for name in sorted(candidates)}
    return OrientationSelection(
        value=value,
        source=source,
        source_detail=source_detail,
        candidates=candidates_ordered,
        qc_tags=qc_tags,
    )


def select_pitch_from_metadata(metadata: ExtractedMetadata) -> OrientationSelection:
    candidate_specs = [
        ("gimbal_pitch", "gimbal_pitch_degree", "imu"),
        ("flight_pitch", "flight_pitch_degree", "imu"),
        ("camera_pitch", "camera_pitch_degree", "imu"),
    ]

    candidates: dict[str, float] = {}
    ordered_candidates: list[tuple[str, float]] = []
    qc_tags: list[str] = []

    for candidate_name, field_name, _source in candidate_specs:
        raw = getattr(metadata, field_name, None)
        normalized, uncertain = _normalize_pitch_degrees(_to_float(raw))
        if normalized is None:
            continue

        candidates[candidate_name] = normalized
        ordered_candidates.append((candidate_name, normalized))
        if uncertain:
            qc_tags.append("qc:pitch_sign_uncertain")

    if not ordered_candidates:
        return OrientationSelection(value=None, source="unknown", source_detail="unknown", candidates={}, qc_tags=["qc:missing_pitch"])

    source_detail, value = ordered_candidates[0]
    source = "imu"

    if source_detail != "gimbal_pitch":
        qc_tags.append("qc:pitch_source_switch")

    if len(ordered_candidates) > 1 and value is not None:
        for _, other in ordered_candidates[1:]:
            if abs(value - other) > 12.0:
                qc_tags.append("qc:pitch_source_conflict")
                break

    candidates_ordered = {name: candidates[name] for name in sorted(candidates)}
    return OrientationSelection(
        value=value,
        source=source,
        source_detail=source_detail,
        candidates=candidates_ordered,
        qc_tags=qc_tags,
    )


def _to_float(value: Any) -> float | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int, float)):
        return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None

    if isinstance(value, (tuple, list)):
        # EXIF rational-like tuples are often [num, den].
        if len(value) == 2 and all(v is not None for v in value):
            num = _to_float(value[0])
            den = _to_float(value[1])
            if num is not None and den not in (None, 0.0):
                return num / den

        for item in value:
            parsed = _to_float(item)
            if parsed is not None:
                return parsed
        return None

    if isinstance(value, dict):
        # Some metadata providers nest values.
        for key in ("value", "Value", "val", "n", "rational"):
            nested = value.get(key)
            parsed = _to_float(nested)
            if parsed is not None:
                return parsed
        return None

    text = str(value).strip()
    if not text:
        return None

    # exiftool can format numbers as "59.1234 deg" or "1 deg, 23 min, ..."
    if " deg" in text.lower():
        match = re.match(r"^[-+]?\d+(?:\.\d+)?", text)
        if match:
            try:
                return float(match.group(0))
            except ValueError:
                pass

    cleaned = re.sub(r"[^0-9.+-eE]", "", text)
    if not cleaned:
        return None

    try:
        parsed = float(cleaned)
    except ValueError:
        return None

    return parsed if parsed != -0.0 else 0.0


def _to_int(value: Any) -> int | None:
    if value is None:
        return None

    if isinstance(value, bool):
        return None

    if isinstance(value, (int,)):
        return int(value)

    if isinstance(value, float):
        return int(value) if value.is_integer() else None

    if isinstance(value, tuple | list):
        if len(value) != 2:
            return None
        first = _to_int(value[0])
        second = _to_int(value[1])
        if first is not None and second is not None:
            return first if second == 1 else None

    text = str(value).strip()
    if not text:
        return None

    cleaned = re.sub(r"[^0-9+-]", "", text)
    if not cleaned:
        return None

    try:
        return int(cleaned)
    except ValueError:
        return None


def _parse_datetime(value: Any) -> datetime | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        return value

    text = str(value).strip()
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def _rational_as_decimal(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)

    if isinstance(value, (tuple, list)) and len(value) == 2:
        num = _to_float(value[0])
        den = _to_float(value[1])
        if num is None or den in (None, 0.0):
            return None
        return num / den

    if isinstance(value, dict):
        num = value.get("numerator")
        den = value.get("denominator")
        return _rational_as_decimal((num, den))

    return _to_float(value)


def _dms_to_decimal(values: tuple[Any, ...] | list[Any], ref: str | None) -> float | None:
    if not isinstance(values, (tuple, list)) or len(values) != 3:
        return None

    degrees = _rational_as_decimal(values[0])
    minutes = _rational_as_decimal(values[1])
    seconds = _rational_as_decimal(values[2])
    if None in (degrees, minutes, seconds):
        return None

    decimal = degrees + (minutes / 60.0) + (seconds / 3600.0)
    if str(ref).upper() in {"S", "W"}:
        decimal *= -1
    return decimal


def _run_exiftool(path: Path) -> dict[str, Any]:
    candidates = [
        "exiftool",
        "/opt/homebrew/bin/exiftool",
        "/usr/local/bin/exiftool",
        "/usr/bin/exiftool",
    ]

    executable: str | None = None
    for candidate in candidates:
        if "/" in candidate:
            if Path(candidate).exists():
                executable = candidate
                break
        else:
            resolved = shutil.which(candidate)
            if resolved:
                executable = resolved
                break

    if executable is None:
        logger.debug(
            "Exiftool er ikke funnet i kjente steder",
            extra={"candidates": candidates},
        )
        return {}

    fields = [f"-{name}" for name in FIELD_ALIASES.keys()]
    cmd = [executable, "-q", "-q", "-n", "-j", "-fast2", *fields, str(path)]

    try:
        process = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        logger.debug("Exiftool mangler på systemet", extra={"path": str(path)})
        return {}

    stdout_text = process.stdout.strip() if process.stdout else ""
    stderr_text = process.stderr.strip() if process.stderr else ""
    if process.returncode != 0:
        logger.debug(
            "Exiftool returnerte advarsler",
            extra={"path": str(path), "returncode": process.returncode, "stderr": stderr_text[:800]},
        )

    if not stdout_text:
        return {}

    try:
        payload = json.loads(stdout_text)
    except json.JSONDecodeError:
        return {}

    if not isinstance(payload, list) or not payload:
        return {}
    item = payload[0]
    if not isinstance(item, dict):
        return {}
    return item


def _extract_with_pillow(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        fallback_width = image.width
        fallback_height = image.height
        exif = image.getexif()
        if not exif:
            return {
                "ImageWidth": fallback_width,
                "ImageHeight": fallback_height,
            }

        gps_data = exif.get(EXIF_GPS_INFO_TAGS[0]) if isinstance(exif, dict) else None
        if isinstance(gps_data, int):
            gps_data = image.getexif().get_ifd(EXIF_GPS_INFO_TAGS[0])  # type: ignore[call-arg]
        if not isinstance(gps_data, dict):
            gps_data = {}

        lat_ref = gps_data.get(EXIF_GPS_LAT_REF_TAG)
        lng_ref = gps_data.get(EXIF_GPS_LNG_REF_TAG)
        altitude_raw = gps_data.get(EXIF_GPS_ALTITUDE_TAG)
        altitude_ref = gps_data.get(EXIF_GPS_ALTITUDE_REF_TAG)

        lat = _dms_to_decimal(gps_data.get(EXIF_GPS_LAT_TAG), lat_ref)
        lng = _dms_to_decimal(gps_data.get(EXIF_GPS_LNG_TAG), lng_ref)
        altitude = _to_float(altitude_raw)
        if altitude is not None and altitude_ref in {1, b"\x01", "1", 1}:
            altitude *= -1

        datetime_raw = None
        for key in EXIF_DATETIME_KEYS:
            value = exif.get(key)
            if value is not None:
                datetime_raw = value
                break

        heading = _to_float(gps_data.get(17)) if 17 in gps_data else _to_float(exif.get(EXIF_HEADING_TAG))

        return {
            "DateTimeOriginal": _parse_datetime(datetime_raw),
            "GPSLatitude": lat,
            "GPSLongitude": lng,
            "GPSAltitude": altitude,
            "Heading": heading,
            "ImageWidth": fallback_width,
            "ImageHeight": fallback_height,
        }


def _normalize_payload(payload: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    int_fields = {"image_width_px", "image_height_px"}
    str_fields = {"focal_plane_resolution_unit", "resolution_unit"}

    for key, canonical_key in FIELD_ALIASES.items():
        raw = payload.get(key)
        if raw is None or raw == "":
            continue
        if canonical_key in {
            "date_time_original",
            "date_time",
        }:
            normalized[canonical_key] = raw
            continue
        if canonical_key in int_fields:
            normalized[canonical_key] = _to_int(raw)
        elif canonical_key in str_fields:
            normalized[canonical_key] = str(raw)
        else:
            normalized[canonical_key] = _to_float(raw)

    # Some fields can land from alternate keys if alias duplicates.
    for canonical_key in {
        "date_time_original",
        "date_time",
        "gps_latitude",
        "gps_longitude",
        "altitude_m",
        "flight_yaw_degree",
        "flight_pitch_degree",
        "gimbal_pitch_degree",
        "gimbal_yaw_degree",
        "compass",
        "camera_pitch_degree",
        "camera_yaw_degree",
        "heading_deg",
        "image_width_px",
        "image_height_px",
        "focal_length_mm",
        "focal_length_35mm_format_mm",
        "f_number",
        "focal_plane_x_resolution",
        "focal_plane_y_resolution",
        "x_resolution",
        "y_resolution",
    }:
        value = normalized.get(canonical_key)
        if value is None:
            normalized[canonical_key] = None

    # Noreserve unit-felter som ofte kan være enum/tekst.
    for canonical_key in {"focal_plane_resolution_unit", "resolution_unit"}:
        if normalized.get(canonical_key) is None and canonical_key in payload:
            normalized[canonical_key] = str(payload[canonical_key])

    # Datetime normalisering:
    date_candidates = [
        normalized.get("date_time_original"),
        normalized.get("date_time"),
        payload.get("DateTimeOriginal"),
        payload.get("DateTime"),
    ]
    normalized["date_time_original"] = _parse_datetime(
        date_candidates[0] if date_candidates[0] is not None else date_candidates[1]
    )

    for key in ("gps_latitude", "gps_longitude", "altitude_m"):
        fallback = _to_float(payload.get(key))
        if fallback is not None:
            normalized[key] = fallback

    return normalized


def _resolution_unit_mm_factor(unit: Any) -> float | None:
    if unit is None:
        return None
    normalized = str(unit).strip().lower()
    if not normalized:
        return None
    if normalized in {"2", "inches", "inch", "in", "i"}:
        return 25.4
    if normalized in {"3", "cm"}:
        return 10.0
    if normalized in {"4", "m"}:
        return 1000.0
    if normalized in {"1", "unitless", "none"}:
        return 1.0

    numeric = _to_float(normalized)
    if numeric is not None and numeric >= 1:
        # 2 = inches is vanligst i ExifTool-output.
        if numeric == 2:
            return 25.4
        if numeric == 3:
            return 10.0
        if numeric == 4:
            return 1000.0
        if numeric == 1:
            return 1.0

    return None


def _resolve_pixel_size_mm(
    focal_plane_x_resolution: float | None,
    focal_plane_y_resolution: float | None,
    focal_plane_unit: Any,
    x_resolution: float | None,
    y_resolution: float | None,
    resolution_unit: Any,
) -> float | None:
    mm_per_unit = _resolution_unit_mm_factor(focal_plane_unit) or _resolution_unit_mm_factor(resolution_unit)
    if mm_per_unit is None:
        return None

    samples = [value for value in (focal_plane_x_resolution, focal_plane_y_resolution, x_resolution, y_resolution) if value and value > 0]
    if not samples:
        return None

    # Exif oppgir oppløsning: antall piksler per enhet.
    # -> pixelstørrelse i mm = mm per enhet / piksler.
    return mm_per_unit / max(sum(samples) / len(samples), 1e-9)


def _off_nadir_degrees(pitch_deg: float | None) -> float | None:
    if pitch_deg is None:
        return None

    if not math.isfinite(pitch_deg):
        return None

    return max(0.0, min(90.0, 90.0 - abs(float(pitch_deg))))


def _derive_gsd_meters(
    altitude_m: float | None,
    focal_length_mm: float | None,
    image_width_px: int | None,
    pixel_size_mm: float | None,
    sensor_width_mm: float | None,
    pitch_deg: float | None,
) -> tuple[float | None, bool]:
    if altitude_m is None or altitude_m <= 0:
        return None, False
    if focal_length_mm is None or focal_length_mm <= 0:
        return None, False

    if image_width_px is None or image_width_px <= 0:
        return None, False

    pixel_pitch_mm = pixel_size_mm
    if pixel_pitch_mm is None and sensor_width_mm is not None and sensor_width_mm > 0:
        pixel_pitch_mm = sensor_width_mm / image_width_px

    if pixel_pitch_mm is None or pixel_pitch_mm <= 0:
        return None, False

    # Standard nadir-formel: GSD = H * p / f
    gsd = altitude_m * 1000.0 * pixel_pitch_mm / focal_length_mm

    off_nadir = _off_nadir_degrees(pitch_deg)
    oblique_correction_applied = False
    if off_nadir is not None and off_nadir > 5.0:
        cos_theta = math.cos(math.radians(off_nadir))
        if cos_theta > 0.0:
            gsd /= cos_theta
            oblique_correction_applied = True

    return gsd, oblique_correction_applied


def extract_metadata(path: Path) -> ExtractedMetadata:
    path = path.resolve()
    issues: list[str] = []

    exiftool_payload = _run_exiftool(path)
    source = "exiftool" if exiftool_payload else "pillow"

    if exiftool_payload:
        payload = exiftool_payload
    else:
        issues.append("exiftool utilgjengelig eller tomt svar")
        payload = _extract_with_pillow(path)
        if not payload:
            issues.append("Ingen EXIF lesbar via fallback (Pillow)")

    normalized = _normalize_payload(payload)

    captured_at = normalized.get("date_time_original")
    if captured_at is None and "date_time" in normalized:
        captured_at = normalized.get("date_time")

    gps_latitude = _to_float(normalized.get("gps_latitude"))
    gps_longitude = _to_float(normalized.get("gps_longitude"))
    altitude_m = _to_float(normalized.get("altitude_m"))
    heading_deg = _to_float(normalized.get("heading_deg"))
    flight_yaw_degree = _to_float(normalized.get("flight_yaw_degree"))
    flight_pitch_degree = _to_float(normalized.get("flight_pitch_degree"))
    gimbal_pitch_degree = _to_float(normalized.get("gimbal_pitch_degree"))
    gimbal_yaw_degree = _to_float(normalized.get("gimbal_yaw_degree"))
    compass = _to_float(normalized.get("compass"))
    camera_pitch_degree = _to_float(normalized.get("camera_pitch_degree"))
    camera_yaw_degree = _to_float(normalized.get("camera_yaw_degree"))
    image_width_px = _to_int(normalized.get("image_width_px"))
    image_height_px = _to_int(normalized.get("image_height_px"))
    focal_length_mm = _to_float(normalized.get("focal_length_mm"))
    focal_length_35mm_format_mm = _to_float(normalized.get("focal_length_35mm_format_mm"))
    f_number = _to_float(normalized.get("f_number"))
    focal_plane_x_resolution = _to_float(normalized.get("focal_plane_x_resolution"))
    focal_plane_y_resolution = _to_float(normalized.get("focal_plane_y_resolution"))
    focal_plane_resolution_unit = normalized.get("focal_plane_resolution_unit")
    x_resolution = _to_float(normalized.get("x_resolution"))
    y_resolution = _to_float(normalized.get("y_resolution"))
    resolution_unit = normalized.get("resolution_unit")

    if image_width_px is None and image_height_px is None:
        issues.append("Billedimensjoner mangler")

    if captured_at is None:
        issues.append("DateTimeOriginal mangler")
    if gps_latitude is None or gps_longitude is None:
        issues.append("GPS-koordinater mangler")
    if heading_deg is None and compass is None and flight_yaw_degree is None and gimbal_yaw_degree is None:
        issues.append("Retningsdata mangler")
    if all(
        value is None for value in (flight_pitch_degree, gimbal_pitch_degree, camera_pitch_degree)
    ):
        issues.append("Pitch-data mangler")

    return ExtractedMetadata(
        source_file=str(path),
        captured_at=captured_at,
        gps_latitude=gps_latitude,
        gps_longitude=gps_longitude,
        altitude_m=altitude_m,
        heading_deg=heading_deg,
        flight_yaw_degree=flight_yaw_degree,
        flight_pitch_degree=flight_pitch_degree,
        gimbal_pitch_degree=gimbal_pitch_degree,
        gimbal_yaw_degree=gimbal_yaw_degree,
        compass=compass,
        camera_pitch_degree=camera_pitch_degree,
        camera_yaw_degree=camera_yaw_degree,
        source=source,
        image_width_px=image_width_px,
        image_height_px=image_height_px,
        focal_length_mm=focal_length_mm,
        focal_length_35mm_format_mm=focal_length_35mm_format_mm,
        f_number=f_number,
        focal_plane_x_resolution=focal_plane_x_resolution,
        focal_plane_y_resolution=focal_plane_y_resolution,
        focal_plane_resolution_unit=focal_plane_resolution_unit,
        x_resolution=x_resolution,
        y_resolution=y_resolution,
        resolution_unit=resolution_unit,
        raw=payload,
        issues=issues,
    )


def derive_ground_sampling(
    metadata: ExtractedMetadata,
    default_overlap_front: float = 0.75,
    default_overlap_side: float = 0.7,
) -> tuple[float | None, float | None, float | None, float | None, float | None, bool]:
    pixel_size_mm = _resolve_pixel_size_mm(
        focal_plane_x_resolution=metadata.focal_plane_x_resolution,
        focal_plane_y_resolution=metadata.focal_plane_y_resolution,
        focal_plane_unit=metadata.focal_plane_resolution_unit,
        x_resolution=metadata.x_resolution,
        y_resolution=metadata.y_resolution,
        resolution_unit=metadata.resolution_unit,
    )

    sensor_width_mm = None
    if (
        metadata.focal_length_mm is not None
        and metadata.focal_length_35mm_format_mm is not None
        and metadata.focal_length_35mm_format_mm > 0
    ):
        try:
            sensor_width_mm = 36.0 * (metadata.focal_length_mm / metadata.focal_length_35mm_format_mm)
        except (TypeError, ValueError):
            sensor_width_mm = None

    pitch_for_gsd = select_pitch_from_metadata(metadata)
    gsd_m, oblique_correction_applied = _derive_gsd_meters(
        altitude_m=metadata.altitude_m,
        focal_length_mm=metadata.focal_length_mm,
        image_width_px=metadata.image_width_px,
        pixel_size_mm=pixel_size_mm,
        sensor_width_mm=sensor_width_mm,
        pitch_deg=pitch_for_gsd.value,
    )

    image_footprint_w_m = None
    if gsd_m is not None and metadata.image_width_px:
        image_footprint_w_m = max(0.0, gsd_m * float(metadata.image_width_px))

    overlap_front = default_overlap_front if default_overlap_front is not None else None
    overlap_side = default_overlap_side if default_overlap_side is not None else None
    track_spacing_m = None
    if image_footprint_w_m is not None and overlap_side is not None and 0 <= overlap_side < 1:
        track_spacing_m = image_footprint_w_m * (1.0 - overlap_side)

    return (
        gsd_m,
        image_footprint_w_m,
        track_spacing_m,
        overlap_front,
        overlap_side,
        oblique_correction_applied,
    )
