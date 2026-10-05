"""Bind a reviewed source to a cadastral property before any Frost request."""
from datetime import date
import math

from .weather_frost import FrostConfig, FrostSeries, fetch_frost
from .weather_season import season_context


def property_weather(start: date, end: date, property_reference: str, settings, *, client=None) -> dict:
    unavailable = season_context(start, end, reason="source_pending_review")
    if not settings.frost_weather_enabled or not settings.frost_client_id.strip():
        return unavailable
    review = settings.frost_reviewed_sources.get(property_reference)
    try:
        if not isinstance(review, dict) or review.get("approved") is not True:
            return unavailable
        reviewed = date.fromisoformat(review["reviewed_at"])
        distance = review["distance_m"]
        if reviewed > date.today() or isinstance(distance, bool) or not isinstance(distance, (int, float)) or not math.isfinite(distance) or not 0 <= distance <= 50_000:
            return unavailable
        if not isinstance(review.get("station_name"), str) or not review["station_name"].strip():
            return unavailable
        if not isinstance(review.get("suitability_note"), str) or not review["suitability_note"].strip():
            return unavailable
        selections = tuple(FrostSeries(**value) for value in review["selections"])
        config = FrostConfig(enabled=True, client_id=settings.frost_client_id, selections=selections, timeout_seconds=settings.frost_http_timeout_seconds)
    except (KeyError, TypeError, ValueError, OverflowError):
        return unavailable
    fetched = fetch_frost(start, end, config, client=client)
    source = fetched["source"]
    if source is not None:
        source["station_review"] = {
            "property_reference": property_reference, "station_name": review["station_name"],
            "distance_m": distance, "reviewed_at": reviewed.isoformat(),
            "suitability_note": review["suitability_note"],
        }
    result = season_context(start, end, observations=fetched["observations"], source=source, reason=fetched["reason"])
    result["rejected_observations"] += fetched["rejected_observations"]
    result["provider_errors"] = fetched.get("provider_errors", [])
    return result
