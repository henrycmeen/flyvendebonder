from __future__ import annotations

from datetime import date, datetime, timedelta

from app.services.heading_backfill import TrackPhotoPoint, infer_heading_from_neighbors


def _point(
    *,
    id: str,
    minute: int,
    lat: float,
    lng: float,
    captured_date: date = date(2025, 7, 18),
) -> TrackPhotoPoint:
    return TrackPhotoPoint(
        id=id,
        captured_at=datetime(2025, 7, 18, 12, 0, 0) + timedelta(minutes=minute),
        captured_date=captured_date,
        lat=lat,
        lng=lng,
    )


def test_infer_heading_prefers_smoothed_prev_to_next_bearing():
    previous = _point(id="a", minute=0, lat=59.0, lng=10.0)
    current = _point(id="b", minute=1, lat=59.0005, lng=10.0005)
    next_point = _point(id="c", minute=2, lat=59.001, lng=10.001)

    heading = infer_heading_from_neighbors(previous, current, next_point)

    assert heading is not None
    assert 20.0 < heading < 50.0


def test_infer_heading_falls_back_to_current_to_next_for_first_photo():
    current = _point(id="b", minute=0, lat=59.0, lng=10.0)
    next_point = _point(id="c", minute=1, lat=59.001, lng=10.0)

    heading = infer_heading_from_neighbors(None, current, next_point)

    assert heading is not None
    assert abs(heading - 0.0) < 0.1


def test_infer_heading_returns_none_when_gap_is_too_large():
    previous = _point(id="a", minute=0, lat=59.0, lng=10.0)
    current = _point(id="b", minute=120, lat=59.001, lng=10.0)

    heading = infer_heading_from_neighbors(previous, current, None, max_gap_seconds=600)

    assert heading is None


def test_infer_heading_returns_none_when_points_are_too_close():
    previous = _point(id="a", minute=0, lat=59.0, lng=10.0)
    current = _point(id="b", minute=1, lat=59.000001, lng=10.000001)

    heading = infer_heading_from_neighbors(previous, current, None, min_distance_m=8.0)

    assert heading is None
