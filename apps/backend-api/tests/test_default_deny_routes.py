from __future__ import annotations

import ast
from pathlib import Path


PUBLIC_ROUTE_FUNCTIONS = {
    "health",
    "get_admin_session_status",
    "login_admin",
    "logout_admin",
}


def _route_functions() -> dict[str, ast.FunctionDef | ast.AsyncFunctionDef]:
    source_path = Path(__file__).parents[1] / "app" / "api" / "v1.py"
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    functions: dict[str, ast.FunctionDef | ast.AsyncFunctionDef] = {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        is_route = any(
            isinstance(decorator, ast.Call)
            and isinstance(decorator.func, ast.Attribute)
            and isinstance(decorator.func.value, ast.Name)
            and decorator.func.value.id == "router"
            and decorator.func.attr in {"get", "post", "put", "patch", "delete"}
            for decorator in node.decorator_list
        )
        if is_route:
            functions[node.name] = node
    return functions


def _has_owner_dependency(node: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    return any(
        isinstance(child, ast.Call)
        and isinstance(child.func, ast.Name)
        and child.func.id == "Depends"
        and child.args
        and isinstance(child.args[0], ast.Name)
        and child.args[0].id == "_request_owner_user"
        for child in ast.walk(node)
    )


def test_private_routes_require_request_bound_owner_dependency():
    routes = _route_functions()

    assert PUBLIC_ROUTE_FUNCTIONS <= routes.keys()
    assert {name for name, node in routes.items() if not _has_owner_dependency(node)} == PUBLIC_ROUTE_FUNCTIONS


def test_private_route_handlers_do_not_fall_back_to_global_pilot_user():
    routes = _route_functions()

    for name, node in routes.items():
        if name in PUBLIC_ROUTE_FUNCTIONS:
            continue
        assert not any(
            isinstance(child, ast.Call)
            and isinstance(child.func, ast.Name)
            and child.func.id == "_current_user"
            for child in ast.walk(node)
        ), name


def test_anonymous_requests_can_only_read_public_allowlist(client):
    logout = client.post("/api/v1/admin/logout")
    assert logout.status_code == 200

    assert client.get("/api/v1/health").status_code == 200
    assert client.get("/api/v1/admin/session").status_code == 200

    private_reads = [
        "/api/v1/profile/current",
        "/api/v1/orthophotos/unknown/color-sample?lat=59&lng=10",
        "/api/v1/timeline/dates",
        "/api/v1/fields",
        "/api/v1/drone-profiles",
        "/api/v1/flight-captures",
        "/api/v1/processing-runs",
        "/api/v1/stac/collections",
        "/api/v1/photos",
        "/api/v1/sources/status",
        "/api/v1/properties/current",
        "/api/v1/media-staging-jobs",
        "/api/v1/video-jobs",
        "/api/v1/logs",
    ]
    for path in private_reads:
        response = client.get(path)
        assert response.status_code == 401, (path, response.status_code, response.text)


def test_bound_session_cannot_override_owner_on_photo_or_timeline_reads(client):
    from app.database import SessionLocal
    from app.models import User
    from app.services.admin_access import decode_admin_session_cookie

    session = decode_admin_session_cookie(client.cookies.get("flyvendebonder_admin"))
    assert session is not None

    with SessionLocal() as db:
        other = User(full_name="Annen lesetest", email="other-read@example.test")
        db.add(other)
        db.commit()
        db.refresh(other)
        other_user_id = other.id

    own_timeline = client.get("/api/v1/timeline/dates")
    own_photos = client.get("/api/v1/photos")
    assert own_timeline.status_code == 200
    assert own_photos.status_code == 200

    timeline_override = client.get("/api/v1/timeline/dates", params={"user_id": other_user_id})
    photos_override = client.get("/api/v1/photos", params={"user_id": other_user_id})
    page_override = client.get(
        "/api/v1/photos/page",
        params={"user_id": other_user_id, "date": "2025-07-18"},
    )

    assert timeline_override.status_code == 403
    assert photos_override.status_code == 403
    assert page_override.status_code == 403
