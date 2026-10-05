from copy import deepcopy
from datetime import date

import httpx
import pytest

from app.services.weather_frost import (
    FrostConfig, FrostSeries, PRECIPITATION, TEMPERATURE, fetch_frost, normalize_frost,
)

DAY = date(2026, 9, 1)
RAIN = FrostSeries(PRECIPITATION, "SN123:0", 0, "PT6H", None)
TEMP = FrostSeries(TEMPERATURE, "SN123:0", 0, "PT0H", {"levelType": "height_above_ground", "unit": "m", "value": 2})


def payload(series=RAIN, reference="2026-09-01T00:00:00Z", value=3):
    obs = {"elementId": series.element_id, "value": value,
           "unit": "mm" if series == RAIN else "degC", "timeOffset": series.time_offset,
           "timeResolution": "P1D", "timeSeriesId": 0, "qualityCode": 0}
    if series.level is not None:
        obs["level"] = series.level
    return {"data": [{"sourceId": series.source_id, "referenceTime": reference, "observations": [obs]}]}


@pytest.mark.parametrize("series,reference,start,end", [
    (RAIN, "2026-09-01T00:00:00Z", "2026-08-31T06:00:00+00:00", "2026-09-01T06:00:00+00:00"),
    (TEMP, "2026-09-01T00:00:00Z", "2026-09-01T00:00:00+00:00", "2026-09-02T00:00:00+00:00"),
    (RAIN, "2026-09-01T06:00:00Z", "2026-08-31T06:00:00+00:00", "2026-09-01T06:00:00+00:00"),
])
def test_daily_periods(series, reference, start, end):
    records, rejected = normalize_frost(payload(series, reference), series, DAY, DAY)
    assert rejected == 0
    assert records[0]["period_start"] == start
    assert records[0]["period_end"] == end
    assert records[0]["provenance"]["reference_time"] == reference
    assert records[0]["series_id"] == series.identity


def test_documented_no_rain_conversion_preserves_raw():
    records, _ = normalize_frost(payload(value=-1), RAIN, DAY, DAY)
    assert records[0]["value"] == 0
    assert records[0]["provenance"]["raw_value"] == -1
    assert records[0]["provenance"]["conversion"] is not None


@pytest.mark.parametrize("key,value", [
    ("qualityCode", 1), ("qualityCode", 2), ("qualityCode", True), ("timeSeriesId", 1),
    ("timeResolution", "PT1H"), ("timeOffset", "PT0H"), ("value", -2),
    ("value", True), ("value", float("nan")), ("unit", "cm"),
])
def test_rejects_unreviewed_observation(key, value):
    data = payload()
    data["data"][0]["observations"][0][key] = value
    assert normalize_frost(data, RAIN, DAY, DAY) == ([], 1)


@pytest.mark.parametrize("missing", ["timeOffset", "timeResolution", "timeSeriesId", "qualityCode", "value", "unit"])
def test_missing_metadata_is_not_inferred(missing):
    data = payload()
    del data["data"][0]["observations"][0][missing]
    assert normalize_frost(data, RAIN, DAY, DAY) == ([], 1)


@pytest.mark.parametrize("variant", ["exact", "sensor", "offset", "value"])
def test_duplicates_or_parallel_sensors_invalidate_date(variant):
    data = payload()
    other = deepcopy(data["data"][0])
    if variant == "sensor":
        other["sourceId"] = "SN123:1"
    elif variant == "offset":
        other["observations"][0]["timeOffset"] = "PT0H"
    elif variant == "value":
        other["observations"][0]["value"] = 6
    data["data"].append(other)
    assert normalize_frost(data, RAIN, DAY, DAY) == ([], 2)


def test_missing_days_stay_missing_and_temperature_level_is_pinned():
    records, _ = normalize_frost(payload(), RAIN, DAY, date(2026, 9, 3))
    assert len(records) == 1
    data = payload(TEMP)
    del data["data"][0]["observations"][0]["level"]
    assert normalize_frost(data, TEMP, DAY, DAY) == ([], 1)


def test_closed_gate_does_not_call_provider_or_expose_id():
    client = httpx.Client(transport=httpx.MockTransport(lambda req: pytest.fail("network call")))
    for config in [FrostConfig(), FrostConfig(enabled=True, selections=(RAIN,)), FrostConfig(client_id="private")]:
        assert fetch_frost(DAY, DAY, config, client=client)["reason"] == "frost_disabled_or_unconfigured"
    config = FrostConfig(enabled=True, client_id="private", selections=())
    assert fetch_frost(DAY, DAY, config, client=client)["reason"] == "frost_selection_unreviewed"
    assert "private" not in repr(config)


def test_fetch_exact_selection_and_half_open_query():
    def handler(req):
        assert req.url.params["sources"] == "SN123:0"
        assert req.url.params["timeoffsets"] == "PT6H"
        assert req.url.params["timeseriesids"] == "0"
        assert req.url.params["timeresolutions"] == "P1D"
        assert req.url.params["referencetime"] == "2026-09-01/2026-09-02"
        assert req.headers["authorization"].startswith("Basic ")
        return httpx.Response(200, json=payload())
    client = httpx.Client(transport=httpx.MockTransport(handler))
    result = fetch_frost(DAY, DAY, FrostConfig(True, "fixture-id", (RAIN,)), client=client)
    assert result["reason"] is None
    assert len(result["observations"]) == 1
    assert result["source"]["series"][PRECIPITATION] == RAIN.identity
    assert "fixture-id" not in str(result)


@pytest.mark.parametrize("status,reason", [(404, "frost_no_data"), (401, "frost_access_denied"), (429, "frost_provider_error"), (500, "frost_provider_error"), (302, "frost_provider_error")])
def test_provider_failures(status, reason):
    client = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status)))
    result = fetch_frost(DAY, DAY, FrostConfig(True, "fixture-id", (RAIN,)), client=client)
    assert result["observations"] == []
    assert result["reason"] == reason


def test_timeout_and_malformed_provider_response():
    def timeout(req):
        raise httpx.ReadTimeout("secret should not appear", request=req)
    for handler, reason in [(timeout, "frost_provider_unreachable"), (lambda req: httpx.Response(200, json={}), "frost_invalid_response")]:
        result = fetch_frost(DAY, DAY, FrostConfig(True, "fixture-id", (RAIN,)), client=httpx.Client(transport=httpx.MockTransport(handler)))
        assert result["reason"] == reason
        assert "secret" not in str(result)


def test_one_failed_element_preserves_other():
    def handler(req):
        return httpx.Response(200, json=payload()) if req.url.params["elements"] == PRECIPITATION else httpx.Response(500)
    result = fetch_frost(DAY, DAY, FrostConfig(True, "fixture-id", (RAIN, TEMP)), client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert len(result["observations"]) == 1
    assert result["provider_errors"] == ["frost_provider_error"]


@pytest.mark.parametrize("start,end", [(DAY, date(2026, 8, 31)), (DAY, date(2027, 9, 3))])
def test_bounded_window_before_network(start, end):
    with pytest.raises(ValueError):
        fetch_frost(start, end, FrostConfig())


def test_missing_metadata_duplicate_invalidates_otherwise_valid_date():
    data = payload()
    other = deepcopy(data["data"][0])
    del other["observations"][0]["timeOffset"]
    data["data"].append(other)
    assert normalize_frost(data, RAIN, DAY, DAY) == ([], 2)


@pytest.mark.parametrize("reference", [None, 5, "2026-09-01T00:00:00", "bad-date"])
def test_malformed_or_naive_reference_is_rejected(reference):
    assert normalize_frost(payload(reference=reference), RAIN, DAY, DAY) == ([], 1)


def test_public_seklima_uses_no_auth_and_preserves_strict_provenance():
    def handler(req):
        assert str(req.url).startswith("https://rim.k8s.met.no/api/v1/observations?")
        assert "authorization" not in req.headers
        assert req.url.params["sources"] == "SN123"
        assert req.url.params["referenceTime"] == "2026-09-01/2026-09-02"
        assert req.url.params["timeResolution"] == "days"
        data = payload()
        data.update(createdAt="2026-10-05T12:00:00Z", apiVersion="v0", license="https://creativecommons.org/licenses/by/3.0/no/", totalItemCount=1)
        data["data"][0]["observations"][0].update(performanceCategory="C", exposureCategory="2")
        return httpx.Response(200, json=data)
    # Explicit auth=None must disable even an injected client's default auth.
    with httpx.Client(auth=("unused", "unused"), transport=httpx.MockTransport(handler)) as client:
        result = fetch_frost(DAY, DAY, FrostConfig(enabled=True, selections=(RAIN,), provider="seklima"), client=client)
    assert len(result["observations"]) == 1
    assert result["source"]["dataset"] == "seKlima public API (Frost observation schema)"
    assert result["source"]["payload_metadata"][0]["total_item_count"] == 1
    assert result["observations"][0]["provenance"]["performance_category"] == "C"


def test_public_transport_retains_quality_gate_and_never_falls_back():
    calls = []
    def handler(req):
        calls.append(req.url.host)
        data = payload()
        data["data"][0]["observations"][0]["qualityCode"] = 1
        return httpx.Response(200, json=data)
    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        result = fetch_frost(DAY, DAY, FrostConfig(enabled=True, selections=(RAIN,), provider="seklima"), client=client)
    assert result["observations"] == []
    assert result["rejected_observations"] == 1
    assert calls == ["rim.k8s.met.no"]
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(412))) as client:
        assert fetch_frost(DAY, DAY, FrostConfig(enabled=True, selections=(RAIN,), provider="seklima"), client=client)["reason"] == "seklima_no_data"


def test_unknown_provider_is_closed_before_network():
    with httpx.Client(transport=httpx.MockTransport(lambda req: pytest.fail("unexpected network"))) as client:
        result = fetch_frost(DAY, DAY, FrostConfig(enabled=True, selections=(RAIN,), provider="other"), client=client)
    assert result["observations"] == []
    assert result["reason"] == "frost_selection_unreviewed"
