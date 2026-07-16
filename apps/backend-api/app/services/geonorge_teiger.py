from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx
from shapely.geometry import shape

from ..config import get_settings
from ..models import Property
from .analysis_enrich import classify_land_use_from_ar5, lookup_ar5_class_at_point
from .field_plots import normalize_polygon_coordinates, polygon_area_m2

logger = logging.getLogger(__name__)
settings = get_settings()


def build_field_candidates_from_geojson(
    payload: dict[str, Any],
    property_obj: Property | None,
    *,
    sort_mode: str,
    source_endpoint: str | None = None,
    source_fetched_at: datetime | None = None,
) -> list[dict[str, Any]]:
    features = payload.get("features") or []
    if not isinstance(features, list):
        raise ValueError("Ugyldig GeoJSON-respons fra Geonorge")

    candidates: list[dict[str, Any]] = []
    for feature in features:
        candidate = _feature_to_candidate(
            feature,
            property_obj,
            source_endpoint=source_endpoint,
            source_fetched_at=source_fetched_at,
        )
        if candidate is None:
            continue
        candidate = _annotate_candidate_land_use(candidate)
        candidates.append(candidate)

    if sort_mode == "point":
        candidates.sort(
            key=lambda item: (
                item["distance_m"] if item["distance_m"] is not None else 10_000_000,
                0 if item["is_main_area"] else 1,
                item["local_id"] if item["local_id"] is not None else 10_000_000,
            )
        )
        return candidates

    candidates.sort(
        key=lambda item: (
            0 if item["is_main_area"] else 1,
            item["local_id"] if item["local_id"] is not None else 10_000_000,
        )
    )
    return candidates


async def list_field_candidates_for_property(property_obj: Property) -> list[dict[str, Any]]:
    source_endpoint = "/geokoding"
    payload, fetched_at = await _fetch_json(
        source_endpoint,
        params={
            "kommunenummer": property_obj.komm,
            "gardsnummer": property_obj.gnr,
            "bruksnummer": property_obj.bnr,
            "festenummer": property_obj.fnr,
            "omrade": "true",
            "utkoordsys": 4258,
        },
    )
    return build_field_candidates_from_geojson(
        payload,
        property_obj,
        sort_mode="property",
        source_endpoint=source_endpoint,
        source_fetched_at=fetched_at,
    )


async def lookup_field_candidates_by_point(
    property_obj: Property,
    *,
    lat: float,
    lng: float,
    radius_m: int | None = None,
) -> list[dict[str, Any]]:
    effective_radius = radius_m or settings.geonorge_point_lookup_radius_m
    source_endpoint = "/punkt/omrader"
    payload, fetched_at = await _fetch_json(
        source_endpoint,
        params={
            "ost": lng,
            "nord": lat,
            "koordsys": 4258,
            "radius": effective_radius,
            "utkoordsys": 4258,
            "maksTreff": settings.geonorge_point_lookup_max_hits,
        },
    )
    return build_field_candidates_from_geojson(
        payload,
        property_obj,
        sort_mode="point",
        source_endpoint=source_endpoint,
        source_fetched_at=fetched_at,
    )


async def lookup_field_candidates_by_point_any(
    *,
    lat: float,
    lng: float,
    radius_m: int | None = None,
) -> list[dict[str, Any]]:
    effective_radius = radius_m or settings.geonorge_point_lookup_radius_m
    source_endpoint = "/punkt/omrader"
    payload, fetched_at = await _fetch_json(
        source_endpoint,
        params={
            "ost": lng,
            "nord": lat,
            "koordsys": 4258,
            "radius": effective_radius,
            "utkoordsys": 4258,
            "maksTreff": settings.geonorge_point_lookup_max_hits,
        },
    )
    return build_field_candidates_from_geojson(
        payload,
        None,
        sort_mode="point",
        source_endpoint=source_endpoint,
        source_fetched_at=fetched_at,
    )


async def _fetch_json(path: str, *, params: dict[str, Any]) -> tuple[dict[str, Any], datetime]:
    url = f"{settings.geonorge_eiendom_api_url.rstrip('/')}{path}"
    async with httpx.AsyncClient(timeout=settings.geonorge_http_timeout_seconds) as client:
        response = await client.get(url, params=params)

    response.raise_for_status()
    fetched_at = datetime.utcnow()
    payload = response.json()
    if not isinstance(payload, dict):
        raise ValueError("Ugyldig respons fra Geonorge")
    return payload, fetched_at


def _feature_to_candidate(
    feature: Any,
    property_obj: Property | None,
    *,
    source_endpoint: str | None = None,
    source_fetched_at: datetime | None = None,
) -> dict[str, Any] | None:
    if not isinstance(feature, dict):
        return None

    properties = feature.get("properties")
    geometry = feature.get("geometry")
    if not isinstance(properties, dict) or not isinstance(geometry, dict):
        return None
    if property_obj is not None and not _feature_matches_property(properties, property_obj):
        return None

    if geometry.get("type") != "Polygon":
        logger.info(
            "Skipping unsupported Geonorge geometry",
            extra={
                "geometry_type": geometry.get("type"),
                "property_id": property_obj.id if property_obj is not None else None,
            },
        )
        return None

    try:
        normalized_coordinates = normalize_polygon_coordinates(geometry.get("coordinates") or [])
    except ValueError:
        logger.info(
            "Skipping invalid Geonorge polygon",
            extra={"property_id": property_obj.id if property_obj is not None else None},
        )
        return None

    area_m2 = polygon_area_m2(normalized_coordinates)
    property_ref = _property_ref_from_properties(properties)
    matrikkelnummer = _coerce_string(properties.get("matrikkelnummertekst")) or _matrikkelnummer_from_parts(
        property_ref["gnr"],
        property_ref["bnr"],
    )
    local_id = _coerce_int(properties.get("lokalid"))
    is_main_area = bool(properties.get("hovedområde"))

    if is_main_area:
        name = f"{matrikkelnummer} · hovedteig"
    elif local_id is not None:
        name = f"{matrikkelnummer} · teig {local_id}"
    else:
        name = f"{matrikkelnummer} · teig"

    return {
        "source": "geonorge",
        "source_endpoint": source_endpoint,
        "source_fetched_at": source_fetched_at,
        "name": name,
        "local_id": local_id,
        "matrikkelnummer": matrikkelnummer,
        "object_type": _coerce_string(properties.get("objekttype")),
        "accuracy_class": _coerce_string(properties.get("nøyaktighetsklasseteig")),
        "is_main_area": is_main_area,
        "distance_m": _coerce_int(properties.get("meterFraPunkt")),
        "geometry": {"type": "Polygon", "coordinates": normalized_coordinates},
        "area_m2": round(area_m2, 2) if area_m2 is not None else None,
        "area_ha": round(area_m2 / 10_000, 4) if area_m2 is not None else None,
        "source_updated_at": _coerce_datetime(properties.get("oppdateringsdato")),
        "property_ref": property_ref,
    }


def _annotate_candidate_land_use(candidate: dict[str, Any]) -> dict[str, Any]:
    geometry = candidate.get("geometry")
    if not isinstance(geometry, dict):
        candidate["ar5_class"] = None
        candidate["land_use_kind"] = "unknown"
        candidate["land_use_label"] = "Uavklart"
        return candidate

    try:
        centroid = shape(geometry).representative_point()
        ar5_class = lookup_ar5_class_at_point(centroid.y, centroid.x)
    except Exception:  # noqa: BLE001
        ar5_class = None

    land_use_kind, land_use_label = classify_land_use_from_ar5(ar5_class)
    candidate["ar5_class"] = ar5_class
    candidate["land_use_kind"] = land_use_kind
    candidate["land_use_label"] = land_use_label
    return candidate


def _feature_matches_property(properties: dict[str, Any], property_obj: Property) -> bool:
    return (
        _coerce_string(properties.get("kommunenummer")) == property_obj.komm
        and _coerce_int(properties.get("gardsnummer")) == property_obj.gnr
        and _coerce_int(properties.get("bruksnummer")) == property_obj.bnr
        and (_coerce_int(properties.get("festenummer")) or 0) == property_obj.fnr
        and (_coerce_int(properties.get("seksjonsnummer")) or 0) == 0
    )


def _matrikkelnummer_from_property(property_obj: Property) -> str:
    return f"{property_obj.gnr}/{property_obj.bnr}"


def _matrikkelnummer_from_parts(gnr: int | None, bnr: int | None) -> str:
    if gnr is None or bnr is None:
        return "ukjent/ukjent"
    return f"{gnr}/{bnr}"


def _property_ref_from_properties(properties: dict[str, Any]) -> dict[str, Any]:
    komm = _coerce_string(properties.get("kommunenummer"))
    gnr = _coerce_int(properties.get("gardsnummer"))
    bnr = _coerce_int(properties.get("bruksnummer"))
    fnr = (_coerce_int(properties.get("festenummer")) or 0)
    return {
        "komm": komm,
        "gnr": gnr,
        "bnr": bnr,
        "fnr": fnr,
        "label": _matrikkelnummer_from_parts(gnr, bnr),
    }


def _coerce_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _coerce_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _coerce_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
