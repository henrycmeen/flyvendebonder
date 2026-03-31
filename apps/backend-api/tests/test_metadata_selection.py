from __future__ import annotations

from datetime import datetime

from app.services.metadata_utils import (
    ExtractedMetadata,
    resolve_photo_altitude,
    select_altitude_from_metadata,
    select_heading_from_metadata,
    select_pitch_from_metadata,
)


def _base_metadata(**overrides) -> ExtractedMetadata:
    base = {
        "source_file": "test.jpg",
        "captured_at": datetime(2025, 7, 18, 12, 0, 0),
        "gps_latitude": 59.0,
        "gps_longitude": 10.0,
        "altitude_m": 100.0,
        "gps_altitude_m": None,
        "relative_altitude_m": None,
        "absolute_altitude_m": None,
        "heading_deg": None,
        "flight_yaw_degree": None,
        "flight_pitch_degree": None,
        "gimbal_pitch_degree": None,
        "gimbal_yaw_degree": None,
        "compass": None,
        "camera_pitch_degree": None,
        "camera_yaw_degree": None,
        "image_width_px": 5120,
        "image_height_px": 3840,
        "focal_length_mm": 8.8,
        "focal_length_35mm_format_mm": 13.2,
        "f_number": 2.8,
        "focal_plane_x_resolution": None,
        "focal_plane_y_resolution": None,
        "focal_plane_resolution_unit": None,
        "x_resolution": None,
        "y_resolution": None,
        "resolution_unit": None,
        "source": "test",
        "raw": {},
        "issues": [],
    }
    base.update(overrides)
    return ExtractedMetadata(**base)


def test_heading_prefers_gimbal_yaw_over_flight_yaw_for_camera_targeting():
    metadata = _base_metadata(flight_yaw_degree=12.0, gimbal_yaw_degree=210.0, compass=15.0)
    selection = select_heading_from_metadata(metadata)

    assert selection.value == 210.0
    assert selection.source == "imu"
    assert selection.source_detail == "gimbal_yaw"
    assert "qc:heading_source_conflict" in selection.qc_tags


def test_heading_switches_to_camera_when_gimbal_heading_mangler():
    metadata = _base_metadata(camera_yaw_degree=45.0, compass=44.0)
    selection = select_heading_from_metadata(metadata)

    assert selection.value == 45.0
    assert selection.source == "imu"
    assert selection.source_detail == "camera_yaw"
    assert "qc:heading_source_switch" in selection.qc_tags


def test_heading_falls_back_to_flight_yaw_when_gimbal_and_camera_heading_mangler():
    metadata = _base_metadata(flight_yaw_degree=12.0, compass=15.0)
    selection = select_heading_from_metadata(metadata)

    assert selection.value == 12.0
    assert selection.source == "imu"
    assert selection.source_detail == "flight_yaw"
    assert "qc:heading_source_switch" in selection.qc_tags


def test_pitch_switches_to_flight_when_gimbal_missing():
    metadata = _base_metadata(flight_pitch_degree=-10.0, camera_pitch_degree=10.0)
    selection = select_pitch_from_metadata(metadata)

    assert selection.value == -10.0
    assert selection.source == "imu"
    assert selection.source_detail == "flight_pitch"
    assert "qc:pitch_source_switch" in selection.qc_tags


def test_pitch_sign_fold_is_marked_as_uncertain():
    metadata = _base_metadata(gimbal_pitch_degree=150.0)
    selection = select_pitch_from_metadata(metadata)

    assert selection.value == 30.0
    assert "qc:pitch_sign_uncertain" in selection.qc_tags


def test_altitude_prefers_relative_altitude_when_available():
    metadata = _base_metadata(
        altitude_m=58.2,
        gps_altitude_m=286.0,
        absolute_altitude_m=285.9,
        relative_altitude_m=58.2,
    )

    selection = select_altitude_from_metadata(metadata)

    assert selection.value == 58.2
    assert selection.source == "relative"
    assert selection.source_detail == "relative_altitude"


def test_resolve_photo_altitude_switches_legacy_absolute_to_relative():
    metadata = _base_metadata(
        altitude_m=58.2,
        gps_altitude_m=286.035,
        absolute_altitude_m=286.1,
        relative_altitude_m=58.2,
    )

    assert resolve_photo_altitude(286.0, metadata) == 58.2


def test_resolve_photo_altitude_keeps_manual_override():
    metadata = _base_metadata(
        altitude_m=58.2,
        gps_altitude_m=286.035,
        absolute_altitude_m=286.1,
        relative_altitude_m=58.2,
    )

    assert resolve_photo_altitude(84.0, metadata) == 84.0
