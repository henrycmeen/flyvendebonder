from __future__ import annotations

import math

from .tag_utils import extract_meta_float, set_meta_value


def extract_manual_view_override(tags: list[str]) -> tuple[float, float] | None:
    lat = extract_meta_float(tags, "meta:manual_view_lat")
    lng = extract_meta_float(tags, "meta:manual_view_lng")
    if lat is None or lng is None:
        return None

    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        return None
    return lat, lng


def set_manual_view_override(tags: list[str], lat: float | None, lng: float | None) -> list[str]:
    if lat is None and lng is None:
        cleared = set_meta_value(tags, "meta:manual_view_lat", None)
        return set_meta_value(cleared, "meta:manual_view_lng", None)

    if lat is None or lng is None:
        raise ValueError("Både manual_view_lat og manual_view_lng må settes sammen")

    if not math.isfinite(lat) or not math.isfinite(lng):
        raise ValueError("Manuelt målpunkt må være gyldige tall")

    if lat < -90 or lat > 90 or lng < -180 or lng > 180:
        raise ValueError("Manuelt målpunkt er utenfor gyldig koordinatområde")

    with_lat = set_meta_value(tags, "meta:manual_view_lat", f"{lat:.6f}")
    return set_meta_value(with_lat, "meta:manual_view_lng", f"{lng:.6f}")
