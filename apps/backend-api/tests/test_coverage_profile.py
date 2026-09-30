from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.services.photos import _build_coverage_profile
from app.services.quality_metrics import rotate_vector


def _build_photo(**overrides):
    defaults = {
        "lat": 59.17,
        "lng": 9.66,
        "altitude_m": 120.0,
        "heading_deg": 0.0,
        "pitch_deg": -89.0,
        "image_footprint_w_m": 10.0,
        "overlap_front": 0.75,
        "overlap_side": 0.70,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def test_coverage_profile_warns_when_actual_gap_large():
    center = _build_photo()
    previous = _build_photo(lat=59.17 + 5 / 111_320)
    next_photo = _build_photo(lat=59.17 - 5 / 111_320)
    profile = _build_coverage_profile(center, previous, next_photo)

    assert profile["neighbor_count"] == 2
    assert profile["planned_front"] == center.overlap_front
    assert profile["planned_side"] == center.overlap_side
    assert profile["actual_front"] == 0.5
    assert profile["quality"] == "warn"


def test_coverage_profile_is_unknown_without_neighbors():
    center = _build_photo()
    profile = _build_coverage_profile(center, None, None)

    assert profile["actual_front"] is None
    assert profile["actual_side"] is None
    assert profile["front_gap"] is None
    assert profile["side_gap"] is None
    assert profile["quality"] == "unknown"


@pytest.mark.parametrize("heading", [None, float("nan"), float("inf")])
def test_missing_heading_does_not_invent_north_facing_overlap(heading):
    center = _build_photo(heading_deg=heading, pitch_deg=None)
    neighbor = _build_photo(lat=59.17 + 5 / 111_320, pitch_deg=None)
    profile = _build_coverage_profile(center, neighbor, None)
    assert profile["neighbor_count"] == 1
    assert profile["actual_front"] is None
    assert profile["actual_side"] is None
    assert profile["quality"] == "unknown"


@pytest.mark.parametrize("heading,expected", [(0, (0, 10)), (90, (10, 0)), (180, (0, -10)), (270, (-10, 0))])
def test_analysis_samples_follow_clockwise_compass_heading(heading, expected):
    assert rotate_vector(0, 10, heading) == pytest.approx(expected)
