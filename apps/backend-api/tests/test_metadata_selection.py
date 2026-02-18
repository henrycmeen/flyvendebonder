from __future__ import annotations

from datetime import datetime

from app.services.metadata_utils import ExtractedMetadata, select_heading_from_metadata, select_pitch_from_metadata


def _base_metadata(**overrides) -> ExtractedMetadata:
    base = {
        "source_file": "test.jpg",
        "captured_at": datetime(2025, 7, 18, 12, 0, 0),
        "gps_latitude": 59.0,
        "gps_longitude": 10.0,
        "altitude_m": 100.0,
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


def test_heading_prefers_flight_yaw_and_marks_conflict_when_other_sources_disagree():
    metadata = _base_metadata(flight_yaw_degree=12.0, gimbal_yaw_degree=210.0, compass=15.0)
    selection = select_heading_from_metadata(metadata)

    assert selection.value == 12.0
    assert selection.source == "imu"
    assert selection.source_detail == "flight_yaw"
    assert "qc:heading_source_conflict" in selection.qc_tags


def test_heading_switches_to_camera_when_imu_heading_mangler():
    metadata = _base_metadata(camera_yaw_degree=45.0, compass=44.0)
    selection = select_heading_from_metadata(metadata)

    assert selection.value == 45.0
    assert selection.source == "imu"
    assert selection.source_detail == "camera_yaw"
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
