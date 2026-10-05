"""Historical series only: missing observations are never zero rainfall.

The provider adapter supplies explicit periods, one reviewed station/series per
element and UTC boundaries. Aggregation never infers periods from labels.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
import math
from typing import Any


def _instant(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Weather periods must include a timezone")
    return result.astimezone(timezone.utc)


def season_context(
    start: date,
    end: date,
    *,
    observations: list[dict[str, Any]] | None = None,
    source: dict[str, Any] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    """Summarize inclusive provider reference dates, preserving real periods.

    Input records: date, element, value, unit, period_start, period_end,
    quality_code, source_id, series_id. Only independently controlled values
    (code 0) are accepted in this first pilot; estimates/corrections stay holes.
    Ambiguous duplicates and overlapping intervals invalidate those records.
    """
    if end < start or (end - start).days > 366:
        raise ValueError("Choose an ordered period of at most 367 dates")
    expected = (end - start).days + 1
    days = {
        (start + timedelta(days=i)).isoformat(): {
            "date": (start + timedelta(days=i)).isoformat(),
            "precipitation_mm": None, "temperature_c": None,
            "precipitation_period": None, "temperature_period": None,
        }
        for i in range(expected)
    }
    accepted: dict[tuple[str, str], list[dict[str, Any]]] = {}
    rejected = 0
    element_fields = {
        "sum(precipitation_amount P1D)": ("precipitation_mm", "mm"),
        "mean(air_temperature P1D)": ("temperature_c", "degC"),
    }
    for record in observations or []:
        element = record.get("element")
        label = record.get("date")
        if element not in element_fields or label not in days:
            continue
        field, unit = element_fields[element]
        try:
            value = float(record["value"])
            a, b = _instant(record["period_start"]), _instant(record["period_end"])
            series = (source or {}).get("series", {}).get(element)
            valid = (
                source is not None and record.get("source_id") == source.get("id")
                and bool(series) and record.get("series_id") == series
                and record.get("quality_code") == 0 and record.get("unit") == unit
                and math.isfinite(value) and b - a == timedelta(days=1)
                and (field != "precipitation_mm" or value >= 0)
            )
        except (KeyError, TypeError, ValueError, OverflowError):
            valid = False
        if not valid:
            rejected += 1
            continue
        accepted.setdefault((label, field), []).append({
            "value": value, "start": a.isoformat(), "end": b.isoformat(),
        })
    # Reject ambiguity instead of picking the first sensor or adding twice.
    candidates = {key: values[0] for key, values in accepted.items() if len(values) == 1}
    rejected += sum(len(values) for values in accepted.values() if len(values) != 1)
    overlapping: set[tuple[str, str]] = set()
    for field, _unit in element_fields.values():
        intervals = sorted(
            ((key, value) for key, value in candidates.items() if key[1] == field),
            key=lambda entry: entry[1]["start"],
        )
        for index, (key, value) in enumerate(intervals):
            for other_key, other in intervals[index + 1:]:
                if other["start"] >= value["end"]:
                    break
                overlapping.update((key, other_key))
    rejected += len(overlapping)
    for key, record in candidates.items():
        if key in overlapping:
            continue
        label, field = key
        days[label][field] = record["value"]
        days[label][field.replace("_mm", "_period").replace("_c", "_period")] = {
            "start": record["start"], "end": record["end"],
        }
    values = list(days.values())
    rain = [day["precipitation_mm"] for day in values if day["precipitation_mm"] is not None]
    temperatures = [day["temperature_c"] for day in values if day["temperature_c"] is not None]
    complete = len(rain) == expected
    return {
        "version": "weather-season-v1",
        "status": "available" if complete and len(temperatures) == expected else "partial" if rain or temperatures else "unavailable",
        "reason": reason if not rain and not temperatures else None,
        "period": {"start": start.isoformat(), "end": end.isoformat(), "basis": "provider_reference_dates", "timezone": "UTC"},
        "source": source,
        "days": values,
        "precipitation": {"observed_sum_mm": round(sum(rain), 3) if rain else None, "complete": complete, "covered_days": len(rain), "expected_days": expected},
        "temperature": {"covered_days": len(temperatures), "expected_days": expected},
        "rejected_observations": rejected,
        "limitations": ["Stasjonsmålinger er ikke målt på jordet.", "Datoene er kildens referansedatoer; de faktiske måleperiodene følger hver verdi.", "Summen gjelder tilgjengelige, kontrollerte observasjoner og er ingen avlingsprognose."],
    }
