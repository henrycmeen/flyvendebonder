from dataclasses import asdict
from types import SimpleNamespace

import httpx
import pytest

from app.services.weather_context import property_weather
from tests.test_weather_frost import DAY, RAIN, TEMP, payload


def settings(**changes):
    values = dict(frost_weather_enabled=True, frost_client_id="fixture-secret",
                  frost_http_timeout_seconds=10, frost_reviewed_sources={
        "4003-70/17/0": dict(approved=True, reviewed_at="2026-09-01",
                            distance_m=2000, station_name="Fixture station",
                            suitability_note="Synthetic test, not a reviewed real station",
                            selections=[asdict(RAIN), asdict(TEMP)])})
    values.update(changes)
    return SimpleNamespace(**values)


@pytest.mark.parametrize("reference,config", [
    ("4003-70/17/0", settings(frost_weather_enabled=False)),
    ("4003-70/17/0", settings(frost_client_id="")),
    ("4003-99/99/0", settings()),
    ("4003-70/17/0", settings(frost_reviewed_sources={})),
])
def test_unconfigured_or_other_property_never_calls_provider(reference, config):
    with httpx.Client(transport=httpx.MockTransport(lambda req: pytest.fail("unexpected provider call"))) as client:
        result = property_weather(DAY, DAY, reference, config, client=client)
    assert result["status"] == "unavailable"
    assert result["source"] is None
    assert "fixture-secret" not in str(result)


def test_reviewed_property_preserves_source_periods_and_raw_conversion():
    def handler(req):
        return httpx.Response(200, json=payload(TEMP, value=12) if req.url.params["elements"] == TEMP.element_id else payload(RAIN, value=-1))
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = property_weather(DAY, DAY, "4003-70/17/0", settings(), client=client)
    assert result["source"]["station_review"]["property_reference"] == "4003-70/17/0"
    assert result["precipitation"]["observed_sum_mm"] == 0
    assert result["temperature"]["mean_c"] == 12
    assert result["days"][0]["precipitation_provenance"]["raw_value"] == -1
    assert result["days"][0]["precipitation_period"]["start"] == "2026-08-31T06:00:00+00:00"
    assert "fixture-secret" not in str(result)


def test_provider_failure_retains_available_element_and_missing_temperature():
    def handler(req):
        return httpx.Response(503) if req.url.params["elements"] == TEMP.element_id else httpx.Response(200, json=payload(RAIN, value=3))
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = property_weather(DAY, DAY, "4003-70/17/0", settings(), client=client)
    assert result["precipitation"]["observed_sum_mm"] == 3
    assert result["temperature"]["mean_c"] is None
    assert result["temperature"]["covered_days"] == 0
    assert result["provider_errors"]


def test_reviewed_public_provider_does_not_require_client_id():
    config = settings(historical_weather_provider="seklima", frost_client_id="")
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(200, json=payload(TEMP) if req.url.params["elements"] == TEMP.element_id else payload(RAIN)))) as client:
        result = property_weather(DAY, DAY, "4003-70/17/0", config, client=client)
    assert result["status"] == "available"
    assert result["source"]["dataset"].startswith("seKlima")


@pytest.mark.parametrize("changes", [{"frost_weather_enabled": False}, {"frost_reviewed_sources": {}}, {"historical_weather_provider": "other"}])
def test_public_provider_retains_review_and_enable_gates(changes):
    config = settings(historical_weather_provider="seklima", frost_client_id="")
    for key, value in changes.items():
        setattr(config, key, value)
    with httpx.Client(transport=httpx.MockTransport(lambda req: pytest.fail("unexpected provider call"))) as client:
        result = property_weather(DAY, DAY, "4003-70/17/0", config, client=client)
    assert result["status"] == "unavailable"
