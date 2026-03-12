from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, Response

from ..config import get_settings


@dataclass(frozen=True)
class AdminSession:
    expires_at: datetime


def admin_access_is_configured() -> bool:
    return bool(get_settings().admin_access_code.strip())


def verify_admin_access_code(code: str) -> bool:
    expected = get_settings().admin_access_code.strip()
    provided = code.strip()
    if not expected or not provided:
        return False
    return secrets.compare_digest(provided, expected)


def get_admin_session(request: Request) -> AdminSession | None:
    settings = get_settings()
    cookie_value = request.cookies.get(settings.admin_session_cookie_name)
    return decode_admin_session_cookie(cookie_value)


def issue_admin_session(response: Response, request: Request) -> AdminSession:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=max(1, settings.admin_session_ttl_hours))
    cookie_value = _encode_admin_session_cookie(expires_at)
    response.set_cookie(
        key=settings.admin_session_cookie_name,
        value=cookie_value,
        max_age=max(1, settings.admin_session_ttl_hours) * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=_request_is_secure(request),
        path="/",
    )
    return AdminSession(expires_at=expires_at)


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

    expires_at_ts = payload.get("exp")
    if not isinstance(expires_at_ts, int):
        return None

    expires_at = datetime.fromtimestamp(expires_at_ts, tz=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None

    return AdminSession(expires_at=expires_at)


def _request_is_secure(request: Request) -> bool:
    forwarded_proto = request.headers.get("x-forwarded-proto", "")
    if forwarded_proto:
        return forwarded_proto.split(",")[0].strip().lower() == "https"
    return request.url.scheme == "https"


def _encode_admin_session_cookie(expires_at: datetime) -> str:
    payload = {
        "v": 1,
        "exp": int(expires_at.astimezone(timezone.utc).timestamp()),
    }
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    signature = _sign_payload(payload_bytes)
    return f"{_urlsafe_encode(payload_bytes)}.{_urlsafe_encode(signature)}"


def _sign_payload(payload_bytes: bytes) -> bytes:
    settings = get_settings()
    secret = (settings.admin_session_secret or settings.admin_access_code).encode("utf-8")
    return hmac.new(secret, payload_bytes, hashlib.sha256).digest()


def _urlsafe_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _urlsafe_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise ValueError("Ugyldig base64 payload") from exc
