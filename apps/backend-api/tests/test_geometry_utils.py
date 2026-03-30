from __future__ import annotations

import pytest

from app.services.geometry_utils import choose_geometry


@pytest.mark.parametrize(
    ("yaw_deg", "lat_relation", "lng_relation"),
    [
        (0.0, "gt", "approx"),
        (90.0, "approx", "gt"),
        (180.0, "lt", "approx"),
        (270.0, "approx", "lt"),
    ],
)
def test_choose_geometry_projects_in_expected_cardinal_direction(yaw_deg: float, lat_relation: str, lng_relation: str):
    result = choose_geometry(
        source_lat=59.0,
        source_lng=10.0,
        altitude_m=100.0,
        pitch_deg=-45.0,
        yaw_deg=yaw_deg,
    )

    assert result.geometry_method == "estimated"
    assert result.forward_distance_m == pytest.approx(100.0, abs=0.05)

    if lat_relation == "gt":
        assert result.lat > 59.0
    elif lat_relation == "lt":
        assert result.lat < 59.0
    else:
        assert result.lat == pytest.approx(59.0, abs=0.00001)

    if lng_relation == "gt":
        assert result.lng > 10.0
    elif lng_relation == "lt":
        assert result.lng < 10.0
    else:
        assert result.lng == pytest.approx(10.0, abs=0.00001)


def test_choose_geometry_returns_source_point_for_near_horizontal_pitch():
    result = choose_geometry(
        source_lat=59.0,
        source_lng=10.0,
        altitude_m=120.0,
        pitch_deg=-0.5,
        yaw_deg=45.0,
    )

    assert result.geometry_method == "point"
    assert result.lat == pytest.approx(59.0)
    assert result.lng == pytest.approx(10.0)
