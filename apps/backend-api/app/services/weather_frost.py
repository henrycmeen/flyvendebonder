"""Reviewed Frost v0 daily series; closed by default, no automatic station choice.

Period and quality semantics: https://frost.met.no/concepts2.html and
https://frost.met.no/dataclarifications.html. Reference dates are provider labels,
not local calendar days. No provider response or credentials are logged.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
import json
import math
import re
from typing import Any

import httpx

PRECIPITATION = "sum(precipitation_amount P1D)"
TEMPERATURE = "mean(air_temperature P1D)"
UNITS = {PRECIPITATION: "mm", TEMPERATURE: "degC"}
ENDPOINT = "https://frost.met.no/observations/v0.jsonld"


@dataclass(frozen=True)
class FrostSeries:
    element_id: str
    source_id: str
    time_series_id: int
    time_offset: str
    level: dict[str, Any] | None

    @property
    def identity(self) -> str:
        return json.dumps({"source_id": self.source_id, "element_id": self.element_id,
                           "time_series_id": self.time_series_id, "time_offset": self.time_offset,
                           "time_resolution": "P1D", "level": self.level}, sort_keys=True, separators=(",", ":"))


@dataclass(frozen=True)
class FrostConfig:
    enabled: bool = False
    client_id: str = field(default="", repr=False)
    selections: tuple[FrostSeries, ...] = ()
    timeout_seconds: float = 10.0


def _offset_hours(value: str) -> int:
    match = re.fullmatch(r"PT(\d+)H", value)
    if not match or not 0 <= int(match[1]) < 24:
        raise ValueError("A reviewed daily UTC offset is required")
    return int(match[1])


def _validate(config: FrostConfig) -> None:
    if not math.isfinite(config.timeout_seconds) or not 0 < config.timeout_seconds <= 30:
        raise ValueError("Frost timeout must be between zero and 30 seconds")
    if not config.selections or len(config.selections) > 2:
        raise ValueError("Pin one or two reviewed daily series")
    if len({s.source_id for s in config.selections}) != 1:
        raise ValueError("This pilot requires one pinned station/sensor")
    if len({s.element_id for s in config.selections}) != len(config.selections):
        raise ValueError("Pin exactly one series per element")
    for s in config.selections:
        if s.element_id not in UNITS or not re.fullmatch(r"SN\d+:0", s.source_id):
            raise ValueError("Pin a supported element and explicit main sensor")
        if type(s.time_series_id) is not int or s.time_series_id != 0:
            raise ValueError("This pilot supports the reviewed official series zero")
        _offset_hours(s.time_offset)
        if s.element_id == TEMPERATURE and s.level != {"levelType": "height_above_ground", "unit": "m", "value": 2}:
            raise ValueError("Daily temperature must be pinned at two metres")
        if s.element_id == PRECIPITATION and s.level is not None:
            raise ValueError("Daily precipitation must have no vertical level")


def _bounds(start: date, end: date) -> None:
    if type(start) is not date or type(end) is not date or end < start or end == date.max or (end - start).days > 366:
        raise ValueError("Choose an ordered window of at most 367 reference dates")


def _period(reference: str, offset: str) -> tuple[datetime, datetime, datetime]:
    ref = datetime.fromisoformat(reference.replace("Z", "+00:00"))
    if ref.tzinfo is None:
        raise ValueError("Missing UTC reference offset")
    ref = ref.astimezone(timezone.utc)
    hours = _offset_hours(offset)
    if ref.time().isoformat() == "00:00:00":
        # PT0H denotes the calendar date; nonzero offsets end on that date.
        end = ref + timedelta(hours=hours) if hours else ref + timedelta(days=1)
    else:
        # Frost already stores actual observation time; never add offset twice.
        end = ref
    return ref, end - timedelta(days=1), end


def normalize_frost(payload: dict[str, Any], selection: FrostSeries, start: date, end: date) -> tuple[list[dict[str, Any]], int]:
    """Return accepted values plus rejected row count, without inventing days.

    Duplicate/conflicting records for the same element/reference date invalidate
    the whole date, including unexpected sensor/offset responses. Code 0 only;
    corrected/interpolated code 1 remains a hole in this controlled-data pilot.
    """
    _bounds(start, end)
    _validate(FrostConfig(selections=(selection,)))
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("Malformed Frost response")
    buckets: dict[str, list[dict[str, Any] | None]] = {}
    rejected = 0
    for entry in payload["data"]:
        if not isinstance(entry, dict) or not isinstance(entry.get("observations"), list):
            rejected += 1
            continue
        for obs in entry["observations"]:
            if not isinstance(obs, dict):
                rejected += 1
                continue
            if obs.get("elementId") != selection.element_id:
                rejected += 1
                continue
            label = None
            try:
                reference = datetime.fromisoformat(entry["referenceTime"].replace("Z", "+00:00"))
                if reference.tzinfo is None:
                    raise ValueError("Missing UTC reference offset")
                reference_date = reference.astimezone(timezone.utc).date()
                if start <= reference_date <= end:
                    label = reference_date.isoformat()
                ref, period_start, period_end = _period(entry["referenceTime"], obs["timeOffset"])
                label = ref.date().isoformat()
                if not start <= ref.date() <= end:
                    rejected += 1
                    continue
                raw_value = obs["value"]
                if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
                    raise ValueError("Not a numeric measurement")
                value = float(raw_value)
                valid = (
                    entry.get("sourceId") == selection.source_id
                    and type(obs.get("timeSeriesId")) is int and obs["timeSeriesId"] == selection.time_series_id
                    and obs.get("timeResolution") == "P1D"
                    and obs.get("timeOffset") == selection.time_offset
                    and obs.get("level") == selection.level
                    and type(obs.get("qualityCode")) is int and obs["qualityCode"] == 0
                    and obs.get("unit") == UNITS[selection.element_id]
                    and math.isfinite(value)
                    and (selection.element_id != PRECIPITATION or value >= 0 or value == -1)
                )
                if not valid:
                    buckets.setdefault(label, []).append(None)
                    continue
                converted = selection.element_id == PRECIPITATION and value == -1
                buckets.setdefault(label, []).append({
                    "date": label, "element": selection.element_id,
                    "value": 0.0 if converted else value, "unit": obs["unit"],
                    "period_start": period_start.isoformat(), "period_end": period_end.isoformat(),
                    "quality_code": 0, "source_id": entry["sourceId"], "series_id": selection.identity,
                    "provenance": {
                        "reference_time": entry["referenceTime"], "raw_value": raw_value,
                        "source_id": entry["sourceId"], "element_id": obs["elementId"],
                        "time_series_id": obs["timeSeriesId"], "time_offset": obs["timeOffset"],
                        "time_resolution": obs["timeResolution"], "level": obs.get("level"),
                        "quality_code": obs["qualityCode"], "unit": obs["unit"],
                        "conversion": "documented_no_precipitation_minus_one_to_zero" if converted else None,
                    },
                })
            except (KeyError, TypeError, ValueError, OverflowError, AttributeError):
                if label is not None:
                    buckets.setdefault(label, []).append(None)
                else:
                    rejected += 1
    records = []
    for label in sorted(buckets):
        rows = buckets[label]
        if len(rows) == 1 and rows[0] is not None:
            records.append(rows[0])
        else:
            rejected += len(rows)
    return records, rejected


def fetch_frost(start: date, end: date, config: FrostConfig, *, client: httpx.Client | None = None) -> dict[str, Any]:
    """Bounded fetch for server use; configuration never enters the response.

    Caller may inject a fixture client. Missing client ID or disabled gate causes
    no network call. Each series is explicitly queried; local checks still pin
    sensor/offset/resolution/level/quality rather than trusting API filtering.
    """
    _bounds(start, end)
    result: dict[str, Any] = {"observations": [], "source": None, "reason": None, "rejected_observations": 0}
    if not config.enabled or not config.client_id.strip():
        result["reason"] = "frost_disabled_or_unconfigured"
        return result
    try:
        _validate(config)
    except (ValueError, TypeError, AttributeError):
        result["reason"] = "frost_selection_unreviewed"
        return result
    result["source"] = {
        "id": config.selections[0].source_id, "provider": "MET Norway", "dataset": "Frost v0",
        "series": {s.element_id: s.identity for s in config.selections},
        "reviewed_selections": [asdict(s) | {"time_resolution": "P1D", "quality_allowlist": [0]} for s in config.selections],
        "attribution": "MET Norway", "license_reference": "https://docs.api.met.no/doc/License.html",
    }
    owned = client is None
    http = client or httpx.Client(follow_redirects=False)
    errors = []
    try:
        for s in config.selections:
            try:
                response = http.get(ENDPOINT, params={
                    "sources": s.source_id, "elements": s.element_id,
                    "referencetime": f"{start.isoformat()}/{(end + timedelta(days=1)).isoformat()}",
                    "timeresolutions": "P1D", "timeoffsets": s.time_offset,
                    "timeseriesids": str(s.time_series_id),
                }, auth=httpx.BasicAuth(config.client_id, ""), timeout=config.timeout_seconds, follow_redirects=False)
                response.raise_for_status()
                records, rejected = normalize_frost(response.json(), s, start, end)
                result["observations"].extend(records)
                result["rejected_observations"] += rejected
            except httpx.HTTPStatusError as exc:
                errors.append("frost_no_data" if exc.response.status_code == 404 else "frost_access_denied" if exc.response.status_code in (401, 403) else "frost_provider_error")
            except httpx.RequestError:
                errors.append("frost_provider_unreachable")
            except (ValueError, TypeError, KeyError, OverflowError):
                errors.append("frost_invalid_response")
        result["reason"] = errors[0] if errors else "frost_no_accepted_observations" if not result["observations"] else None
        result["provider_errors"] = sorted(set(errors))
        return result
    finally:
        if owned:
            http.close()
