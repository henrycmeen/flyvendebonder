from datetime import date

import pytest

from app.services.weather_season import season_context


RAIN = "sum(precipitation_amount P1D)"
TEMP = "mean(air_temperature P1D)"
SOURCE = {"id": "SN-test:0", "series": {RAIN: "rain-daily-06", TEMP: "temp-daily-00"}, "provider": "fixture"}


def observation(day, amount, *, element=RAIN, **changes):
    previous = date(2026, 4, day - 1).isoformat()
    current = date(2026, 4, day).isoformat()
    record = {
        "date": current, "element": element, "value": amount,
        "unit": "mm" if element == RAIN else "degC",
        "period_start": f"{previous}T06:00:00Z", "period_end": f"{current}T06:00:00Z",
        "quality_code": 0, "source_id": SOURCE["id"], "series_id": SOURCE["series"][element],
    }
    record.update(changes)
    return record


def test_known_sum_and_holes_never_become_zero():
    result = season_context(date(2026, 4, 2), date(2026, 4, 5), source=SOURCE, observations=[
        observation(2, 12.5), observation(3, 0), observation(4, 9, quality_code=7),
    ])
    assert result["status"] == "partial"
    assert result["precipitation"] == {"observed_sum_mm": 12.5, "complete": False, "covered_days": 2, "expected_days": 4}
    assert [row["precipitation_mm"] for row in result["days"]] == [12.5, 0, None, None]
    assert result["days"][0]["precipitation_period"]["start"] == "2026-04-01T06:00:00+00:00"


def test_complete_dry_period_is_distinct_from_unavailable():
    period = (date(2026, 4, 2), date(2026, 4, 2))
    dry = season_context(*period, source=SOURCE, observations=[observation(2, 0), observation(2, 5, element=TEMP)])
    missing = season_context(*period, reason="source_not_configured")
    assert dry["status"] == "available"
    assert dry["precipitation"]["observed_sum_mm"] == 0
    assert missing["status"] == "unavailable"
    assert missing["precipitation"]["observed_sum_mm"] is None


@pytest.mark.parametrize("changes", [
    {"source_id": "other"}, {"series_id": "other"}, {"unit": "cm"},
    {"value": float("nan")}, {"value": -2}, {"quality_code": 1},
    {"quality_code": None}, {"period_start": "2026-04-01T06:00:00"},
    {"period_start": "2026-04-01T18:00:00Z"},
])
def test_unreviewed_or_invalid_records_fail_closed(changes):
    result = season_context(date(2026, 4, 2), date(2026, 4, 2), source=SOURCE, observations=[observation(2, 8, **changes)])
    assert result["precipitation"]["observed_sum_mm"] is None
    assert result["rejected_observations"] == 1


def test_duplicate_sensors_and_overlap_are_not_double_counted():
    result = season_context(date(2026, 4, 2), date(2026, 4, 4), source=SOURCE, observations=[
        observation(2, 5), observation(2, 6), observation(3, 7),
        observation(4, 8, period_start="2026-04-02T18:00:00Z", period_end="2026-04-03T18:00:00Z"),
    ])
    assert result["precipitation"]["covered_days"] == 0
    assert result["precipitation"]["observed_sum_mm"] is None


def test_rejects_inverted_and_excessive_periods():
    with pytest.raises(ValueError):
        season_context(date(2026, 4, 3), date(2026, 4, 2))
    with pytest.raises(ValueError):
        season_context(date(2025, 1, 1), date(2026, 4, 2))


def test_weather_gate_preserves_missing_data_and_property_access(client):
    response = client.get("/api/v1/weather/season?start=2026-03-31&end=2026-08-02")
    assert response.status_code == 200
    result = response.json()
    assert result["property_id"] > 0
    assert result["status"] == "unavailable"
    assert result["reason"] == "source_pending_review"
    assert result["source"] is None
    assert result["precipitation"]["observed_sum_mm"] is None
    assert response.headers["cache-control"] == "no-store"
    assert client.get("/api/v1/weather/season?start=2026-03-31&end=2026-08-02&property_id=999999").status_code == 404
    assert client.get("/api/v1/weather/season?start=2026-08-02&end=2026-03-31").status_code == 422
    assert client.get("/api/v1/weather/season?start=2099-01-01&end=2099-01-02").status_code == 422


def test_temperature_mean_and_raw_provenance_are_preserved_without_filling_holes():
    record = observation(2, 3, element=TEMP, provenance={"raw_value":3,"reference_time":"2026-04-02T00:00:00Z"})
    result = season_context(date(2026,4,2), date(2026,4,3), source=SOURCE, observations=[record])
    assert result["temperature"] == {"mean_c":3,"complete":False,"covered_days":1,"expected_days":2}
    assert result["days"][0]["temperature_provenance"]["raw_value"] == 3
    assert result["days"][1]["temperature_c"] is None
