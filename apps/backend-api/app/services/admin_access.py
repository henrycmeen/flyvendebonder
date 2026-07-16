from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response

from ..config import get_settings

logger = logging.getLogger(__name__)

# In-memory brute-force throttle for admin login. The app is effectively
# single-admin, so a small per-client window is sufficient and avoids an extra
# dependency. State is reset on process restart.
_LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60
_LOGIN_MAX_ATTEMPTS = 7
_login_attempts: dict[str, list[float]] = {}

# Per-process signing key used only when no explicit admin_session_secret is
# configured. Generated once so cookies stay valid for the lifetime of the
# process; sessions are invalidated on restart, which is acceptable for the
# single admin user. Avoids signing cookies with the admin access code itself.
_EPHEMERAL_SESSION_SECRET = secrets.token_bytes(32)
_warned_about_ephemeral_secret = False


@dataclass(frozen=True)
class AdminSession:
    user_id: int
    expires_at: datetime


def admin_access_is_configured() -> bool:
    return bool(get_settings().admin_access_code.strip())


def _login_client_key(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "")
    if forwarded_for:
        first = forwarded_for.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def _recent_login_attempts(key: str, now: float) -> list[float]:
    attempts = [ts for ts in _login_attempts.get(key, []) if now - ts < _LOGIN_ATTEMPT_WINDOW_SECONDS]
    if attempts:
        _login_attempts[key] = attempts
    else:
        _login_attempts.pop(key, None)
    return attempts


def enforce_login_rate_limit(request: Request) -> None:
    key = _login_client_key(request)
    attempts = _recent_login_attempts(key, time.monotonic())
    if len(attempts) >= _LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="For mange påloggingsforsøk. Vent noen minutter og prøv igjen.",
        )


def register_failed_login(request: Request) -> None:
    key = _login_client_key(request)
    now = time.monotonic()
    attempts = _recent_login_attempts(key, now)
    attempts.append(now)
    _login_attempts[key] = attempts


def reset_login_attempts(request: Request) -> None:
    _login_attempts.pop(_login_client_key(request), None)


def verify_admin_access_code(code: str) -> bool:
    expected = get_settings().admin_access_code.strip()
    provided = code.strip()
    if not expected or not provided:
        return False
    return secrets.compare_digest(provided, expected)


def get_admin_session(request: Request) -> AdminSession | None:
    if not admin_access_is_configured():
        return None
    settings = get_settings()
    cookie_value = request.cookies.get(settings.admin_session_cookie_name)
    return decode_admin_session_cookie(cookie_value)


def issue_admin_session(response: Response, request: Request, *, user_id: int) -> AdminSession:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=max(1, settings.admin_session_ttl_hours))
    cookie_value = _encode_admin_session_cookie(expires_at, user_id=user_id)
    response.set_cookie(
        key=settings.admin_session_cookie_name,
        value=cookie_value,
        max_age=max(1, settings.admin_session_ttl_hours) * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=_request_is_secure(request),
        path="/",
    )
    return AdminSession(user_id=user_id, expires_at=expires_at)


def clear_admin_session(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.admin_session_cookie_name,
        httponly=True,
        samesite="lax",
        path="/",
    )


def require_admin_session(request: Request) -> AdminSession:
    if not admin_access_is_configured():
        raise HTTPException(status_code=503, detail="Admin-innlogging er ikke konfigurert i backend")

    session = get_admin_session(request)
    if session is None:
        raise HTTPException(status_code=401, detail="Admin-innlogging kreves for denne handlingen")
    return session


def decode_admin_session_cookie(raw_value: str | None) -> AdminSession | None:
    if not raw_value:
        return None

    payload_part, separator, signature_part = raw_value.partition(".")
    if not payload_part or not separator or not signature_part:
        return None

    try:
        payload_bytes = _urlsafe_decode(payload_part)
        signature = _urlsafe_decode(signature_part)
    except ValueError:
        return None

    expected_signature = _sign_payload(payload_bytes)
    if not hmac.compare_digest(signature, expected_signature):
        return None

    try:
        payload = json.loads(payload_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None

    if not isinstance(payload, dict):
        return None

    if payload.get("v") != 2:
        return None

    expires_at_ts = payload.get("exp")
    user_id = payload.get("uid")
    if (
        not isinstance(expires_at_ts, int)
        or isinstance(expires_at_ts, bool)
        or not isinstance(user_id, int)
        or isinstance(user_id, bool)
        or user_id <= 0
    ):
        return None

    expires_at = datetime.fromtimestamp(expires_at_ts, tz=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None

    return AdminSession(user_id=user_id, expires_at=expires_at)


def _request_is_secure(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def _encode_admin_session_cookie(expires_at: datetime, *, user_id: int) -> str:
    if not isinstance(user_id, int) or isinstance(user_id, bool) or user_id <= 0:
        raise ValueError("user_id must be positive")
    payload = {
        "v": 2,
        "uid": user_id,
        "exp": int(expires_at.astimezone(timezone.utc).timestamp()),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = _sign_payload(payload_bytes)
    return f"{_urlsafe_encode(payload_bytes)}.{_urlsafe_encode(signature)}"


def _sign_payload(payload_bytes: bytes) -> bytes:
    secret = _session_signing_secret()
    return hmac.new(secret, payload_bytes, hashlib.sha256).digest()


def _session_signing_secret() -> bytes:
    global _warned_about_ephemeral_secret
    configured = get_settings().admin_session_secret.strip()
    if configured:
        return configured.encode("utf-8")
    if not _warned_about_ephemeral_secret:
        logger.warning(
            "admin_session_secret er ikke satt – bruker en flyktig nøkkel per prosess. "
            "Sett ADMIN_SESSION_SECRET for stabile admin-sesjoner."
        )
        _warned_about_ephemeral_secret = True
    return _EPHEMERAL_SESSION_SECRET


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValueError("Ugyldig base64 payload") from exc
