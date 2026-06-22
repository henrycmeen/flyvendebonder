from __future__ import annotations

import math
import logging
from datetime import datetime
from typing import Any
from xml.etree import ElementTree as ET

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Photo, PhotoAnalysis
from .geometry_utils import GeometryResult, choose_geometry
from .metadata_utils import (
    ExtractedMetadata,
    extract_metadata,
    resolve_photo_altitude,
    select_heading_from_metadata,
    select_pitch_from_metadata,
)
from .tag_utils import parse_tag_json
from .view_overrides import extract_manual_view_override

logger = logging.getLogger(__name__)
settings = get_settings()

_XML_SKIP_FIELDS = {
    "boundedby",
    "box",
    "coordinates",
    "pos",
    "poslist",
    "polygon",
    "linestring",
    "point",
    "multisurface",
    "surfaceproperty",
    "curveproperty",
    "geom",
    "the_geom",
    "shape",
}

_AR5_NON_FIELD_HINTS = {
    "åpen fastmark",
    "åpne arealer",
    "bebygd",
    "samferdsel",
    "ferskvann",
    "elv",
    "innsjø",
    "vei",
    "vann",
}

_AR5_NON_FIELD_HINT_KEYWORDS = {
    "bebygd",
    "samferdsel",
    "ferskvann",
    "elv",
    "innsjø",
    "vei",
    "vann",
    "road",
    "water",
    "built",
    "forest",
}

_AR5_FIELD_HINTS = {
    "fulldyrka jord",
    "overflatedyrka jord",
    "innmarksbeite",
}

_AR5_FIELD_HINT_KEYWORDS = {
    "dyrka",
    "jord",
    "beite",
    "åker",
    "eng",
}

_PHOTO_ANALYSIS_ESTIMATED_FALLBACK_DISTANCE_M = 120.0
_PHOTO_ANALYSIS_ESTIMATED_FALLBACK_SCORE_THRESHOLD = 1


def _split_comma_values(raw: str) -> list[str]:
    return [item.strip() for item in raw.split(",") if item.strip()]


def _distance_m(from_lat: float, from_lng: float, to_lat: float, to_lng: float) -> float:
    mean_lat_rad = math.radians((from_lat + to_lat) / 2.0)
    east_m = (to_lng - from_lng) * 111_320.0 * max(0.000001, math.cos(mean_lat_rad))
    north_m = (to_lat - from_lat) * 111_320.0
    return math.sqrt(east_m * east_m + north_m * north_m)


def _build_fallback_metadata(photo: Photo) -> ExtractedMetadata:
    return ExtractedMetadata(
        source_file=photo.source_filename,
        captured_at=photo.captured_at,
        gps_latitude=photo.lat,
        gps_longitude=photo.lng,
        altitude_m=photo.altitude_m,
        gps_altitude_m=photo.altitude_m,
        relative_altitude_m=photo.altitude_m,
        absolute_altitude_m=photo.altitude_m,
        heading_deg=photo.heading_deg,
        flight_yaw_degree=None,
        flight_pitch_degree=None,
        gimbal_pitch_degree=None,
        gimbal_yaw_degree=None,
        compass=None,
        camera_pitch_degree=None,
        camera_yaw_degree=None,
        source="database",
        raw={"fallback": True, "photo_id": photo.id},
        issues=["Originalfil mangler i assets under analyse", "metadata_fallback_bruker_photo_radarsak"],
    )


def _local_name(tag_name: str) -> str:
    if "}" in tag_name:
        return tag_name.split("}", 1)[1]
    return tag_name


def _extract_records_from_json_payload(payload: Any) -> list[dict[str, str]]:
    if not isinstance(payload, dict):
        return []
    features = payload.get("features")
    if not isinstance(features, list):
        return []

    records: list[dict[str, str]] = []
    for feature in features:
        if not isinstance(feature, dict):
            continue
        properties = feature.get("properties")
        if not isinstance(properties, dict):
            continue

        record: dict[str, str] = {}
        for key, value in properties.items():
            if value is None:
                continue
            text = str(value).strip()
            if not text:
                continue
            record[str(key)] = text
        if record:
            records.append(record)
    return records


def _extract_records_from_xml_payload(payload: str) -> list[dict[str, str]]:
    if not payload.strip():
        return []

    try:
        root = ET.fromstring(payload)
    except ET.ParseError:
        return []

    records: list[dict[str, str]] = []
    seen: set[tuple[tuple[str, str], ...]] = set()

    for node in root.iter():
        children = list(node)
        if not children:
            continue

        record: dict[str, str] = {}
        for child in children:
            if list(child):
                continue
            key = _local_name(child.tag)
            key_lower = key.lower()
            if key_lower in _XML_SKIP_FIELDS:
                continue

            value = (child.text or "").strip()
            if not value:
                continue
            record[key] = value

        if not record:
            continue

        marker = tuple(sorted(record.items()))
        if marker in seen:
            continue
        seen.add(marker)
        records.append(record)

    return records


def _extract_records_from_plain_payload(payload: str) -> list[dict[str, str]]:
    lines = [line.strip() for line in payload.splitlines()]
    record: dict[str, str] = {}

    for line in lines:
        if not line:
            continue
        lowered = line.lower()
        if lowered.startswith("getfeatureinfo results"):
            continue
        if lowered.startswith("layer "):
            continue
        if lowered.startswith("feature "):
            continue

        if ":" in line:
            key, value = line.split(":", 1)
        elif "=" in line:
            key, value = line.split("=", 1)
        else:
            continue

        key_text = key.strip()
        value_text = value.strip()
        if not key_text or not value_text:
            continue
        record[key_text] = value_text

    return [record] if record else []


def _extract_response_records(response: httpx.Response) -> list[dict[str, str]]:
    content_type = response.headers.get("content-type", "").lower()
    body_text = response.text or ""

    if "application/json" in content_type:
        try:
            return _extract_records_from_json_payload(response.json())
        except Exception:  # noqa: BLE001
            return []

    if "xml" in content_type or body_text.lstrip().startswith("<"):
        return _extract_records_from_xml_payload(body_text)

    return _extract_records_from_plain_payload(body_text)


def _best_feature_value(record: dict[str, str], field_hints: list[str]) -> str | None:
    lowered_hints = [hint.lower() for hint in field_hints]

    if lowered_hints:
        for hint in lowered_hints:
            for key, value in record.items():
                key_name = str(key).lower().strip()
                if key_name == hint:
                    return str(value).strip()

        for hint in lowered_hints:
            for key, value in record.items():
                key_name = str(key).lower().strip()
                if hint in key_name:
                    return str(value).strip()

        return None

    for value in record.values():
        text = str(value).strip()
        if text:
            return text
    return None


def _value_from_records(records: list[dict[str, str]], field_hints: list[str]) -> str | None:
    for record in records:
        value = _best_feature_value(record, field_hints)
        if value:
            return value
    return None


def _sampling_offset_deg(base_radius_deg: float) -> float:
    # Bruk et lite nabolag rundt analysepunktet for å redusere kantstøy i kartlag.
    return max(0.00001, min(0.00008, base_radius_deg * 0.35))


def _sampling_points(lat: float, lng: float, offset_deg: float) -> list[tuple[float, float]]:
    return [
        (lat, lng),  # sentrum
        (lat + offset_deg, lng),  # nord
        (lat - offset_deg, lng),  # sør
        (lat, lng + offset_deg),  # øst
        (lat, lng - offset_deg),  # vest
    ]


def _normalize_property_value(value: str) -> str:
    return " ".join(value.strip().split())


def _normalize_class_value(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = _normalize_property_value(value)
    return normalized.casefold() if normalized else None


def _is_value_present(value: str | None) -> bool:
    normalized = _normalize_class_value(value)
    if not normalized:
        return False
    return normalized not in {"none", "null", "ukjent", "ukjent verdi", "ikke tilgjengelig", "-"}


def _is_off_field_ar5(value: str | None) -> bool:
    normalized = _normalize_class_value(value)
    if not normalized:
        return False

    if normalized in _AR5_NON_FIELD_HINTS:
        return True

    return any(keyword in normalized for keyword in _AR5_NON_FIELD_HINT_KEYWORDS)


def classify_land_use_from_ar5(value: str | None) -> tuple[str, str]:
    normalized = _normalize_class_value(value)
    if not normalized:
        return "unknown", "Uavklart"

    if normalized in _AR5_FIELD_HINTS or any(keyword in normalized for keyword in _AR5_FIELD_HINT_KEYWORDS):
        return "field", "Jord"

    if _is_off_field_ar5(value):
        if "skog" in normalized or "forest" in normalized:
            return "forest", "Skog"
        return "other", "Ikke jord"

    return "unknown", "Uavklart"


def lookup_ar5_class_at_point(lat: float, lng: float) -> str | None:
    if not settings.photo_ar5_wms_url or not settings.photo_ar5_wms_layers:
        return None
    ar5_hints = _split_comma_values(settings.photo_ar5_wms_layer_fields) or _split_comma_values(settings.photo_ar5_layer_fields)
    return _query_layer_value(
        lat=lat,
        lng=lng,
        url_wms=settings.photo_ar5_wms_url,
        layers_wms=settings.photo_ar5_wms_layers,
        field_hints=ar5_hints,
        url_wfs=settings.photo_ar5_wfs_url,
        layers_wfs=settings.photo_ar5_wfs_layers,
        layer_fields_fallback=_split_comma_values(settings.photo_ar5_layer_fields),
    )


def _analysis_context_score(ar5_value: str | None, soil_value: str | None) -> int:
    score = 0

    if _is_value_present(ar5_value):
        score += 1
        if _is_off_field_ar5(ar5_value):
            score -= 3

    if _is_value_present(soil_value):
        score += 1

    return score


def _estimate_to_source_fallback_needed(
    geometry: GeometryResult,
    estimated_ar5: str | None,
    estimated_soil: str | None,
) -> bool:
    if geometry.geometry_method != "estimated":
        return False

    if geometry.forward_distance_m is None or geometry.forward_distance_m < _PHOTO_ANALYSIS_ESTIMATED_FALLBACK_DISTANCE_M:
        return False

    if _is_off_field_ar5(estimated_ar5):
        return True

    return geometry.confidence < 0.85 and (
        not _is_value_present(estimated_soil) or not _is_value_present(estimated_ar5)
    )


def _query_layer_value(
    lat: float,
    lng: float,
    url_wms: str,
    layers_wms: str,
    field_hints: list[str],
    url_wfs: str,
    layers_wfs: str,
    layer_fields_fallback: list[str],
) -> str | None:
    value = _query_wms_property(url=url_wms, layers=layers_wms, lat=lat, lng=lng, field_hints=field_hints)
    if value is not None:
        return value

    return _query_wfs_property(
        url=url_wfs,
        layers=layers_wfs,
        lat=lat,
        lng=lng,
        field_hints=layer_fields_fallback,
    )


def _majority_value(values: list[str]) -> str | None:
    if not values:
        return None

    counts: dict[str, int] = {}
    display: dict[str, str] = {}
    order: list[str] = []

    for raw_value in values:
        normalized = _normalize_property_value(raw_value)
        if not normalized:
            continue
        key = normalized.casefold()
        if key not in counts:
            counts[key] = 0
            display[key] = normalized
            order.append(key)
        counts[key] += 1

    if not counts:
        return None

    best_key = order[0]
    best_count = counts[best_key]
    for key in order[1:]:
        key_count = counts[key]
        if key_count > best_count:
            best_key = key
            best_count = key_count

    return display[best_key]


def _query_wfs_property_at_point(
    client: httpx.Client,
    *,
    url: str,
    layers: str,
    lat: float,
    lng: float,
    field_hints: list[str],
) -> str | None:
    if not url or not layers:
        return None

    layer_list = _split_comma_values(layers)
    if not layer_list:
        return None

    radius_deg = settings.photo_analysis_lookup_radius_deg
    bbox = f"{lng - radius_deg},{lat - radius_deg},{lng + radius_deg},{lat + radius_deg},EPSG:4326"

    params = {
        "service": "WFS",
        "request": "GetFeature",
        "version": "2.0.0",
        "outputFormat": "text/xml; subtype=gml/3.2",
        "bbox": bbox,
        "srsName": "EPSG:4326",
        "count": "10",
    }

    for layer in layer_list:
        query = params.copy()
        query["typeNames"] = layer
        query["typeName"] = layer

        try:
            response = client.get(url, params=query)
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "WFS-spørring feilet",
                extra={"url": url, "layer": layer, "error": str(exc)},
            )
            continue

        records = _extract_response_records(response)
        value = _value_from_records(records, field_hints)
        if value:
            return value

    return None


def _query_wfs_property(url: str, layers: str, lat: float, lng: float, field_hints: list[str]) -> str | None:
    if not url or not layers:
        return None

    sample_values: list[str] = []
    sample_points = _sampling_points(lat, lng, _sampling_offset_deg(settings.photo_analysis_lookup_radius_deg))

    with httpx.Client(timeout=settings.photo_analysis_http_timeout_seconds) as client:
        for sample_lat, sample_lng in sample_points:
            value = _query_wfs_property_at_point(
                client,
                url=url,
                layers=layers,
                lat=sample_lat,
                lng=sample_lng,
                field_hints=field_hints,
            )
            if value:
                sample_values.append(value)

    return _majority_value(sample_values)


def _query_wms_property_at_point(
    client: httpx.Client,
    *,
    url: str,
    layers: str,
    lat: float,
    lng: float,
    field_hints: list[str],
) -> str | None:
    if not url or not layers:
        return None

    layer_list = _split_comma_values(layers)
    if not layer_list:
        return None

    radius_deg = settings.photo_analysis_wms_query_radius_deg
    bbox = f"{lng - radius_deg},{lat - radius_deg},{lng + radius_deg},{lat + radius_deg}"

    params = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetFeatureInfo",
        "SRS": "EPSG:4326",
        "BBOX": bbox,
        "WIDTH": "101",
        "HEIGHT": "101",
        "X": "50",
        "Y": "50",
        "INFO_FORMAT": "application/vnd.ogc.gml",
        "FEATURE_COUNT": "10",
    }

    for layer in layer_list:
        query = params.copy()
        query["LAYERS"] = layer
        query["QUERY_LAYERS"] = layer

        try:
            response = client.get(url, params=query)
            response.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.debug(
                "WMS GetFeatureInfo feilet",
                extra={"url": url, "layer": layer, "error": str(exc)},
            )
            continue

        records = _extract_response_records(response)
        value = _value_from_records(records, field_hints)
        if value:
            return value

    return None


def _query_wms_property(url: str, layers: str, lat: float, lng: float, field_hints: list[str]) -> str | None:
    if not url or not layers:
        return None

    sample_values: list[str] = []
    sample_points = _sampling_points(lat, lng, _sampling_offset_deg(settings.photo_analysis_wms_query_radius_deg))

    with httpx.Client(timeout=settings.photo_analysis_http_timeout_seconds) as client:
        for sample_lat, sample_lng in sample_points:
            value = _query_wms_property_at_point(
                client,
                url=url,
                layers=layers,
                lat=sample_lat,
                lng=sample_lng,
                field_hints=field_hints,
            )
            if value:
                sample_values.append(value)

    return _majority_value(sample_values)


def _query_ar5_value(lat: float, lng: float, field_hints: list[str]) -> str | None:
    if not settings.photo_ar5_enabled:
        return None

    return _query_layer_value(
        lat=lat,
        lng=lng,
        url_wms=settings.photo_ar5_wms_url,
        layers_wms=settings.photo_ar5_wms_layers,
        field_hints=field_hints,
        url_wfs=settings.photo_ar5_wfs_url,
        layers_wfs=settings.photo_ar5_wfs_layers,
        layer_fields_fallback=_split_comma_values(settings.photo_ar5_layer_fields),
    )


def _query_soil_value(lat: float, lng: float, field_hints: list[str]) -> str | None:
    return _query_layer_value(
        lat=lat,
        lng=lng,
        url_wms=settings.photo_soil_wms_url,
        layers_wms=settings.photo_soil_wms_layers,
        field_hints=field_hints,
        url_wfs=settings.photo_soil_wfs_url,
        layers_wfs=settings.photo_soil_wfs_layers,
        layer_fields_fallback=_split_comma_values(settings.photo_soil_layer_fields),
    )


def _derive_geometry(
    photo: Photo,
    metadata: ExtractedMetadata,
) -> GeometryResult:
    if not settings.photo_analysis_enabled:
        return GeometryResult(lat=photo.lat, lng=photo.lng, geometry_method="manual", confidence=0.6)

    manual_override = extract_manual_view_override(parse_tag_json(photo.tags_json))
    if manual_override is not None:
        manual_lat, manual_lng = manual_override
        return GeometryResult(
            lat=manual_lat,
            lng=manual_lng,
            geometry_method="manual",
            confidence=1.0,
            forward_distance_m=_distance_m(photo.lat, photo.lng, manual_lat, manual_lng),
        )

    # UI viser view-punkt basert på photo-feltene. Vi prioriterer de samme feltene i analyse for konsistens.
    pitch = photo.pitch_deg if photo.pitch_deg is not None else select_pitch_from_metadata(metadata).value
    yaw = photo.heading_deg if photo.heading_deg is not None else select_heading_from_metadata(metadata).value
    altitude = resolve_photo_altitude(photo.altitude_m, metadata)

    if pitch is None or yaw is None or altitude is None:
        return GeometryResult(lat=photo.lat, lng=photo.lng, geometry_method="point", confidence=0.6)

    return choose_geometry(
        source_lat=photo.lat,
        source_lng=photo.lng,
        altitude_m=altitude,
        pitch_deg=pitch,
        yaw_deg=yaw,
    )


def enrich_photo(
    db: Session,
    photo: Photo,
    *,
    force: bool = False,
) -> PhotoAnalysis:
    query = select(PhotoAnalysis).where(PhotoAnalysis.photo_id == photo.id)
    existing = db.execute(query).scalar_one_or_none()

    if existing and not force:
        # Vi ønsker ikke å rekalkulere på hver listeforespørsel. Ny vurdering skjer eksplisitt via
        # /photos/{id}/approve-analysis, /photos/{id}/recompute-analysis eller /analysis/refresh.
        return existing

    if not settings.photo_analysis_enabled:
        if force:
            if existing is None:
                existing = PhotoAnalysis(
                    photo_id=photo.id,
                    ar5_class=None,
                    soil_class=None,
                    geometry_method="manual",
                    confidence=0.6,
                    approved=False,
                    computed_at=datetime.utcnow(),
                )
                db.add(existing)
                db.commit()
                db.refresh(existing)
            return existing

        if existing is None:
            existing = PhotoAnalysis(
                photo_id=photo.id,
                ar5_class=None,
                soil_class=None,
                geometry_method="manual",
                confidence=0.6,
                approved=False,
                computed_at=datetime.utcnow(),
            )
            db.add(existing)
            db.commit()
            db.refresh(existing)
        return existing

    original_asset = next((asset for asset in photo.assets if asset.kind == "original"), None)
    if original_asset is None:
        metadata = _build_fallback_metadata(photo)
    else:
        original_path = settings.app_data_root / original_asset.path
        if original_path.exists():
            metadata = extract_metadata(original_path)
        else:
            metadata = _build_fallback_metadata(photo)

            logger.info(
                "Originalfil mangler under analyse, bruker fallback metadata",
                extra={"photo_id": photo.id, "path": str(original_path)},
            )

    corrected_altitude = resolve_photo_altitude(photo.altitude_m, metadata)
    if corrected_altitude is not None and corrected_altitude != photo.altitude_m:
        photo.altitude_m = corrected_altitude

    geometry = _derive_geometry(photo=photo, metadata=metadata)

    ar5_hints = _split_comma_values(settings.photo_ar5_wms_layer_fields) or _split_comma_values(settings.photo_ar5_layer_fields)
    soil_hints = _split_comma_values(settings.photo_soil_wms_layer_fields) or _split_comma_values(settings.photo_soil_layer_fields)

    ar5 = _query_ar5_value(geometry.lat, geometry.lng, ar5_hints)
    soil = _query_soil_value(geometry.lat, geometry.lng, soil_hints)

    if _estimate_to_source_fallback_needed(
        geometry=geometry,
        estimated_ar5=ar5,
        estimated_soil=soil,
    ):
        ar5_source = _query_ar5_value(photo.lat, photo.lng, ar5_hints)
        soil_source = _query_soil_value(photo.lat, photo.lng, soil_hints)

        estimated_score = _analysis_context_score(ar5, soil)
        source_score = _analysis_context_score(ar5_source, soil_source)

        if source_score - estimated_score >= _PHOTO_ANALYSIS_ESTIMATED_FALLBACK_SCORE_THRESHOLD:
            logger.info(
                "Fallback til droneposisjon for AR5/jordsmonn",
                extra={
                    "photo_id": photo.id,
                    "estimated": {"ar5": ar5, "soil": soil, "score": estimated_score},
                    "source": {"ar5": ar5_source, "soil": soil_source, "score": source_score},
                    "distance_m": geometry.forward_distance_m,
                    "confidence": geometry.confidence,
                },
            )
            ar5 = ar5_source
            soil = soil_source

    if existing is None:
        existing = PhotoAnalysis(
            photo_id=photo.id,
            ar5_class=ar5,
            soil_class=soil,
            geometry_method=geometry.geometry_method,
            confidence=geometry.confidence,
            approved=False,
            computed_at=datetime.utcnow(),
        )
        db.add(existing)
    else:
        existing.ar5_class = ar5
        existing.soil_class = soil
        existing.geometry_method = geometry.geometry_method
        existing.confidence = geometry.confidence
        existing.approved = False
        existing.computed_at = datetime.utcnow()

    if geometry.geometry_method != "estimated":
        existing.confidence = min(existing.confidence or 0.0, 0.6)

    db.commit()
    db.refresh(existing)

    logger.info(
        "Analysetrekk for bilde",
        extra={
            "photo_id": photo.id,
            "source": metadata.source,
            "geometry_method": existing.geometry_method,
            "confidence": existing.confidence,
            "analysis_lat": round(geometry.lat, 6),
            "analysis_lng": round(geometry.lng, 6),
            "ar5": existing.ar5_class,
            "soil": existing.soil_class,
            "approved": existing.approved,
        },
    )

    return existing


def rebuild_photo_analysis_for_user(
    db: Session,
    user_id: int,
    *,
    force: bool = False,
) -> dict[str, int]:
    photos = db.execute(select(Photo).where(Photo.user_id == user_id).order_by(Photo.captured_at)).scalars().all()

    count_total = 0
    count_done = 0
    count_failed = 0

    for photo in photos:
        count_total += 1
        try:
            db.refresh(photo)
            enrich_photo(db, photo, force=force)
            count_done += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("Analyse feilet", extra={"photo_id": photo.id, "error": str(exc)})
            count_failed += 1

    return {"requested": count_total, "processed": count_done, "failed": count_failed}
