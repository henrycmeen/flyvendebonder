from __future__ import annotations

from app.services.analysis_enrich import _majority_value, _sampling_points


def test_majority_value_picks_most_frequent_case_insensitive():
    value = _majority_value(
        [
            "  Fulldyrka jord  ",
            "fulldyrka   jord",
            "Skog",
            "FULLDYRKA JORD",
        ]
    )
    assert value == "Fulldyrka jord"


def test_majority_value_uses_first_seen_on_tie():
    value = _majority_value(["Skog", "Fulldyrka"])
    assert value == "Skog"


def test_sampling_points_center_north_south_east_west():
    center_lat = 59.1708
    center_lng = 9.6607
    offset = 0.00005

    points = _sampling_points(center_lat, center_lng, offset)
    assert points[0] == (center_lat, center_lng)
    assert points[1] == (center_lat + offset, center_lng)
    assert points[2] == (center_lat - offset, center_lng)
    assert points[3] == (center_lat, center_lng + offset)
    assert points[4] == (center_lat, center_lng - offset)
