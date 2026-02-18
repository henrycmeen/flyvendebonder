from __future__ import annotations

from app.services.analysis_enrich import (
    _analysis_context_score,
    _estimate_to_source_fallback_needed,
    _is_off_field_ar5,
)
from app.services.geometry_utils import GeometryResult


def test_off_field_ar5_is_flagged():
    assert _is_off_field_ar5("Åpen fastmark") is True
    assert _is_off_field_ar5("Fulldyrka jord") is False
    assert _is_off_field_ar5("Ferskvann") is True


def test_analysis_context_score_prefers_cropped_context():
    cropped = _analysis_context_score("Fulldyrka jord", "Svært god jordkvalitet")
    off_field = _analysis_context_score("Åpen fastmark", "Svært god jordkvalitet")

    assert cropped > off_field
    assert cropped == 2
    assert off_field == -1


def test_fallback_needed_for_far_estimated_off_field():
    geometry = GeometryResult(
        lat=59.168146,
        lng=9.662754,
        geometry_method="estimated",
        confidence=0.8,
        forward_distance_m=150.0,
    )

    assert _estimate_to_source_fallback_needed(
        geometry=geometry,
        estimated_ar5="Åpen fastmark",
        estimated_soil=None,
    ) is True


def test_fallback_not_needed_for_close_estimations():
    geometry = GeometryResult(
        lat=59.168146,
        lng=9.662754,
        geometry_method="estimated",
        confidence=0.8,
        forward_distance_m=50.0,
    )

    assert _estimate_to_source_fallback_needed(
        geometry=geometry,
        estimated_ar5="Åpen fastmark",
        estimated_soil=None,
    ) is False


def test_fallback_when_far_and_low_confidence_missing_context():
    geometry = GeometryResult(
        lat=59.168146,
        lng=9.662754,
        geometry_method="estimated",
        confidence=0.7,
        forward_distance_m=150.0,
    )

    assert _estimate_to_source_fallback_needed(
        geometry=geometry,
        estimated_ar5=None,
        estimated_soil=None,
    ) is True
