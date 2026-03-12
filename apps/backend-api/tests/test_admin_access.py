from __future__ import annotations

from datetime import date


def test_admin_session_status_reflects_login_state(client):
    status = client.get("/api/v1/admin/session")
    assert status.status_code == 200
    payload = status.json()
    assert payload["configured"] is True
    assert payload["authenticated"] is True
    assert payload["expires_at"] is not None


def test_admin_logout_blocks_subsequent_writes(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200
    assert logout.json()["authenticated"] is False

    response = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": "+47 22222222"}},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Admin-innlogging kreves for denne handlingen"


def test_admin_login_rejects_invalid_code(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    invalid = client.post("/api/v1/admin/login", json={"code": "feil-kode"})
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Ugyldig admin-kode"


def test_admin_write_requires_login(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert photos_response.status_code == 200
    photo_id = photos_response.json()["photos"][0]["id"]

    response = client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={"caption": "Skal avvises"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "Admin-innlogging kreves for denne handlingen"
