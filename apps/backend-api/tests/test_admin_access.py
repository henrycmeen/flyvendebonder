from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import date, datetime, timedelta, timezone

import pytest


def _set_bound_admin_session(client, user_id: int) -> None:
    from app.config import get_settings
    from app.services.admin_access import _encode_admin_session_cookie

    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    cookie = _encode_admin_session_cookie(expires_at, user_id=user_id)
    client.cookies.clear()
    client.cookies.set(get_settings().admin_session_cookie_name, cookie)


def _create_secondary_owner(*, full_name: str = "Sekundær testbonde") -> tuple[int, int]:
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, Property, User

    with SessionLocal() as db:
        user = User(
            full_name=full_name,
            phone="+47 33333333",
            email="secondary@example.test",
        )
        farm = Farm(name="Sekundær testgård")
        db.add_all([user, farm])
        db.flush()
        membership = FarmMembership(
            farm_id=farm.id,
            user_id=user.id,
            role="owner",
            status="active",
        )
        db.add_all(
            [
                membership,
                Property(
                    user_id=user.id,
                    farm_id=farm.id,
                    komm="4003",
                    gnr=88,
                    bnr=8,
                    fnr=0,
                    label="Sekundær eiendom",
                ),
            ]
        )
        db.commit()
        return user.id, membership.id


def _legacy_v1_cookie() -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    payload_bytes = json.dumps(
        {"v": 1, "exp": int(expires_at.timestamp())},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    signature = hmac.new(b"test-admin-secret", payload_bytes, hashlib.sha256).digest()

    def encode(value: bytes) -> str:
        return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")

    return f"{encode(payload_bytes)}.{encode(signature)}"


def test_admin_session_status_reflects_login_state(client):
    status = client.get("/api/v1/admin/session")
    assert status.status_code == 200
    payload = status.json()
    assert payload["configured"] is True
    assert payload["open_access"] is False
    assert payload["authenticated"] is True
    assert payload["expires_at"] is not None


def test_open_access_needs_no_cookie_and_cannot_be_logged_out(client, monkeypatch):
    from app.config import get_settings

    client.cookies.clear()
    monkeypatch.setenv("ADMIN_ACCESS_OPEN", "true")
    get_settings.cache_clear()
    try:
        status = client.get("/api/v1/admin/session")
        assert status.status_code == 200
        assert status.json() == {
            "configured": True,
            "open_access": True,
            "authenticated": True,
            "expires_at": None,
        }

        private_profile = client.get("/api/v1/profile/current")
        assert private_profile.status_code == 200

        login_without_code = client.post("/api/v1/admin/login", json={})
        assert login_without_code.status_code == 200
        assert login_without_code.json()["open_access"] is True
        assert login_without_code.json()["authenticated"] is True

        logout = client.post("/api/v1/admin/logout")
        assert logout.status_code == 200
        assert logout.json()["open_access"] is True
        assert logout.json()["authenticated"] is True

        private_profile_after_logout = client.get("/api/v1/profile/current")
        assert private_profile_after_logout.status_code == 200
    finally:
        get_settings.cache_clear()


def test_admin_login_binds_cookie_to_pilot_owner(client):
    from app.database import SessionLocal
    from app.models import User
    from app.services.admin_access import decode_admin_session_cookie
    from sqlalchemy import select

    client.post("/api/v1/admin/logout")
    login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert login.status_code == 200

    with SessionLocal() as db:
        pilot_id = db.execute(select(User.id).where(User.full_name == "Roar Meen")).scalar_one()
    cookie = client.cookies.get("flyvendebonder_admin")
    session = decode_admin_session_cookie(cookie)

    assert session is not None
    assert session.user_id == pilot_id


def test_admin_login_rejects_ambiguous_pilot_owner(client):
    _create_secondary_owner(full_name="Roar Meen")
    client.post("/api/v1/admin/logout")

    login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})

    assert login.status_code == 503
    assert login.json()["detail"] == "Flere aktive eiere krever eksplisitt ADMIN_USER_ID"


def test_admin_user_id_selects_owner_when_multiple_exist(client, monkeypatch):
    from app.config import get_settings
    from app.services.admin_access import decode_admin_session_cookie

    secondary_user_id, _membership_id = _create_secondary_owner()
    monkeypatch.setenv("ADMIN_USER_ID", str(secondary_user_id))
    get_settings.cache_clear()
    try:
        client.post("/api/v1/admin/logout")
        login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})

        assert login.status_code == 200
        session = decode_admin_session_cookie(client.cookies.get("flyvendebonder_admin"))
        assert session is not None
        assert session.user_id == secondary_user_id
    finally:
        get_settings.cache_clear()


def test_profile_rename_survives_seeding_and_next_login(client):
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, User
    from app.services.admin_access import decode_admin_session_cookie
    from app.services.seeding import run_seeding
    from sqlalchemy import func, select

    current_session = decode_admin_session_cookie(client.cookies.get("flyvendebonder_admin"))
    assert current_session is not None

    update = client.patch(
        "/api/v1/profile/current",
        json={"user": {"full_name": "Omdøpt pilotbonde"}},
    )
    assert update.status_code == 200

    with SessionLocal() as db:
        run_seeding(db)
        renamed_user = db.get(User, current_session.user_id)
        assert renamed_user is not None
        assert renamed_user.full_name == "Omdøpt pilotbonde"
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(Farm)) == 1
        assert db.scalar(select(func.count()).select_from(FarmMembership)) == 1

    client.post("/api/v1/admin/logout")
    login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert login.status_code == 200
    renewed_session = decode_admin_session_cookie(client.cookies.get("flyvendebonder_admin"))
    assert renewed_session is not None
    assert renewed_session.user_id == current_session.user_id


def test_renamed_revoked_owner_is_not_replaced_by_seeding(client):
    from app.database import SessionLocal
    from app.models import Farm, FarmMembership, User
    from app.services.admin_access import decode_admin_session_cookie
    from app.services.pilot_identity import PilotIdentityConfigurationError
    from app.services.seeding import run_seeding
    from sqlalchemy import func, select

    current_session = decode_admin_session_cookie(client.cookies.get("flyvendebonder_admin"))
    assert current_session is not None
    rename = client.patch(
        "/api/v1/profile/current",
        json={"user": {"full_name": "Tilbakekalt pilotbonde"}},
    )
    assert rename.status_code == 200

    with SessionLocal() as db:
        membership = db.execute(
            select(FarmMembership).where(FarmMembership.user_id == current_session.user_id)
        ).scalar_one()
        membership.status = "revoked"
        db.commit()

        with pytest.raises(PilotIdentityConfigurationError):
            run_seeding(db)

        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(Farm)) == 1
        assert db.scalar(select(func.count()).select_from(FarmMembership)) == 1

    client.post("/api/v1/admin/logout")
    login = client.post("/api/v1/admin/login", json={"code": "test-admin-code"})
    assert login.status_code == 503
    assert login.json()["detail"] == (
        "Eksisterende brukere uten aktiv eier kan ikke bootstrappe pilotidentitet"
    )


def test_bound_session_reads_and_updates_only_its_profile(client):
    from app.database import SessionLocal
    from app.models import User

    secondary_user_id, _membership_id = _create_secondary_owner()
    _set_bound_admin_session(client, secondary_user_id)

    private_profile = client.get("/api/v1/profile/current")
    assert private_profile.status_code == 200
    assert private_profile.json()["user"]["full_name"] == "Sekundær testbonde"
    assert private_profile.json()["user"]["phone"] == "+47 33333333"

    update = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": "+47 44444444"}},
    )
    assert update.status_code == 200
    assert update.json()["user"]["phone"] == "+47 44444444"

    with SessionLocal() as db:
        pilot = db.get(User, 1)
        secondary = db.get(User, secondary_user_id)
        assert pilot is not None
        assert secondary is not None
        assert pilot.phone != "+47 44444444"
        assert secondary.phone == "+47 44444444"


def test_bound_session_reads_only_its_fields_photos_and_property(client):
    primary_photos = client.get(
        "/api/v1/photos",
        params={"date": "2025-07-18", "mode": "day"},
    )
    assert primary_photos.status_code == 200
    primary_photo_id = primary_photos.json()["photos"][0]["id"]

    secondary_user_id, _membership_id = _create_secondary_owner()
    _set_bound_admin_session(client, secondary_user_id)

    secondary_timeline = client.get("/api/v1/timeline/dates")
    secondary_photos = client.get("/api/v1/photos")
    secondary_fields = client.get("/api/v1/fields")
    secondary_property = client.get("/api/v1/properties/current")
    primary_assets = client.get(f"/api/v1/photos/{primary_photo_id}/assets")

    assert secondary_timeline.status_code == 200
    assert secondary_timeline.json()["dates"] == []
    assert secondary_photos.status_code == 200
    assert secondary_photos.json()["photos"] == []
    assert secondary_fields.status_code == 200
    assert secondary_fields.json()["fields"] == []
    assert secondary_property.status_code == 200
    assert secondary_property.json()["property"]["label"] == "Sekundær eiendom"
    assert primary_assets.status_code == 404


def test_bound_session_rejects_revoked_owner_membership(client):
    from app.database import SessionLocal
    from app.models import FarmMembership

    secondary_user_id, membership_id = _create_secondary_owner()
    _set_bound_admin_session(client, secondary_user_id)
    with SessionLocal() as db:
        membership = db.get(FarmMembership, membership_id)
        assert membership is not None
        membership.status = "revoked"
        db.commit()

    response = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": "+47 55555555"}},
    )
    assert response.status_code == 403


def test_bound_session_rejects_unknown_user(client):
    _set_bound_admin_session(client, 999_999)

    response = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": "+47 55555555"}},
    )
    assert response.status_code == 401


def test_legacy_v1_cookie_is_invalidated(client):
    from app.config import get_settings

    client.cookies.clear()
    client.cookies.set(get_settings().admin_session_cookie_name, _legacy_v1_cookie())

    status = client.get("/api/v1/admin/session")
    assert status.status_code == 200
    assert status.json()["authenticated"] is False
    clear_cookie = status.headers.get("set-cookie", "").lower()
    assert f"{get_settings().admin_session_cookie_name}=" in clear_cookie
    assert "max-age=0" in clear_cookie


def test_disabling_admin_access_revokes_private_reads_and_clears_cookie(client, monkeypatch):
    from app.config import get_settings

    private_phone = "+47 46666666"
    update = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": private_phone}},
    )
    assert update.status_code == 200
    assert update.json()["user"]["phone"] == private_phone
    signed_cookie = client.cookies.get("flyvendebonder_admin")
    assert signed_cookie is not None

    monkeypatch.setenv("ADMIN_ACCESS_CODE", "")
    get_settings.cache_clear()
    try:
        private_profile = client.get("/api/v1/profile/current")
        assert private_profile.status_code == 503

        client.cookies.set("flyvendebonder_admin", signed_cookie)
        status = client.get("/api/v1/admin/session")
        assert status.status_code == 200
        assert status.json()["configured"] is False
        assert status.json()["authenticated"] is False
        clear_cookie = status.headers.get("set-cookie", "").lower()
        assert "flyvendebonder_admin=" in clear_cookie
        assert "max-age=0" in clear_cookie
    finally:
        get_settings.cache_clear()


def test_bound_cookie_rejects_tampering_and_expiry(client):
    from app.services.admin_access import _encode_admin_session_cookie, decode_admin_session_cookie

    valid = _encode_admin_session_cookie(
        datetime.now(timezone.utc) + timedelta(hours=1),
        user_id=1,
    )
    payload, signature = valid.split(".", maxsplit=1)
    replacement = "A" if signature[0] != "A" else "B"
    tampered = f"{payload}.{replacement}{signature[1:]}"
    expired = _encode_admin_session_cookie(
        datetime.now(timezone.utc) - timedelta(seconds=1),
        user_id=1,
    )

    assert decode_admin_session_cookie(tampered) is None
    assert decode_admin_session_cookie(expired) is None


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


def test_profile_requires_login_and_returns_private_contact_fields_after_login(client):
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

    anonymous_profile = client.get("/api/v1/profile/current")
    assert anonymous_profile.status_code == 401

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
    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert photos_response.status_code == 200
    photo_id = photos_response.json()["photos"][0]["id"]

    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    anonymous_photos = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert anonymous_photos.status_code == 401

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
