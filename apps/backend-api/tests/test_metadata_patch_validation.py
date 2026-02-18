from __future__ import annotations

from datetime import date

import pytest


def _first_photo_id(client) -> str:
    response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["photos"]
    return payload["photos"][0]["id"]


@pytest.mark.parametrize(
    ("payload", "expected_detail"),
    [
        ({"altitude_m": 20_000}, "altitude_m må være mellom -500 og 12000"),
        ({"heading_deg": 361}, "heading_deg må være mellom -360 og 360"),
        ({"pitch_deg": -120}, "pitch_deg må være mellom -90 og 90"),
    ],
)
def test_photo_metadata_patch_rejects_out_of_range_values(client, payload, expected_detail):
    photo_id = _first_photo_id(client)

    response = client.patch(f"/api/v1/photos/{photo_id}/metadata", json=payload)

    assert response.status_code == 400
    assert response.json()["detail"] == expected_detail


def test_photo_metadata_patch_requires_manual_view_pair(client):
    photo_id = _first_photo_id(client)

    response = client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={"manual_view_lat": 59.15},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Både manual_view_lat og manual_view_lng må sendes sammen"


def test_photo_metadata_patch_accepts_boundary_values(client):
    photo_id = _first_photo_id(client)

    response = client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={
            "altitude_m": -500.0,
            "heading_deg": 360.0,
            "pitch_deg": 90.0,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["altitude_m"] == -500.0
    assert payload["heading_deg"] == 360.0
    assert payload["pitch_deg"] == 90.0
