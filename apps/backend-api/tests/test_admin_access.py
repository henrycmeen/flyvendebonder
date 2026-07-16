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


def test_public_profile_redacts_private_contact_fields(client):
    update = client.patch(
        "/api/v1/profile/current",
        json={
            "user": {
                "phone": "+47 22222222",
                "email": "private@example.test",
                "address_line1": "Privatveien 1",
                "postal_code": "0001",
                "city": "Privatsted",
            }
        },
    )
    assert update.status_code == 200

    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    public_profile = client.get("/api/v1/profile/current")
    assert public_profile.status_code == 200
    assert public_profile.headers["cache-control"] == "no-store"
    public_user = public_profile.json()["user"]
    for field in ("phone", "email", "address_line1", "postal_code", "city"):
        assert public_user[field] is None

    login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert login.status_code == 200
    private_profile = client.get("/api/v1/profile/current")
    assert private_profile.headers["cache-control"] == "no-store"
    private_user = private_profile.json()["user"]
    assert private_user["phone"] == "+47 22222222"
    assert private_user["email"] == "private@example.test"
    assert private_user["address_line1"] == "Privatveien 1"
    assert private_user["postal_code"] == "0001"
    assert private_user["city"] == "Privatsted"


def test_admin_login_rejects_invalid_code(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    invalid = client.post("/api/v1/admin/login", json={"code": "feil-kode"})
    assert invalid.status_code == 401
    assert invalid.json()["detail"] == "Ugyldig admin-kode"


def test_admin_login_throttles_repeated_failures(client):
    client.post("/api/v1/admin/logout")

    for _ in range(7):
        rejected = client.post("/api/v1/admin/login", json={"code": "feil-kode"})
        assert rejected.status_code == 401

    # Further attempts are throttled, even with the correct code.
    throttled = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert throttled.status_code == 429


def test_admin_login_success_clears_throttle(client):
    client.post("/api/v1/admin/logout")

    for _ in range(3):
        rejected = client.post("/api/v1/admin/login", json={"code": "feil-kode"})
        assert rejected.status_code == 401

    accepted = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert accepted.status_code == 200
    assert accepted.json()["authenticated"] is True


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


def test_logs_require_admin_login(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    response = client.get("/api/v1/logs", params={"limit": 5})
    assert response.status_code == 401
    assert response.json()["detail"] == "Admin-innlogging kreves for denne handlingen"
