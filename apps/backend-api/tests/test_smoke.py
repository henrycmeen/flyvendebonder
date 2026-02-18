from __future__ import annotations

from datetime import date


def test_health_smoke(client):
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "Flyvendebonder API"


def test_profile_get_and_patch_smoke(client):
    response = client.get("/api/v1/profile/current")
    assert response.status_code == 200
    profile = response.json()

    assert profile["user"]["full_name"] == "Roar Meen"
    assert profile["property"]["komm"] == "4003"
    assert profile["property"]["gnr"] == 70
    assert profile["property"]["bnr"] == 17

    patch_response = client.patch(
        "/api/v1/profile/current",
        json={"user": {"phone": "+47 11111111"}},
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["user"]["phone"] == "+47 11111111"

    confirm = client.get("/api/v1/profile/current").json()
    assert confirm["user"]["phone"] == "+47 11111111"


def test_timeline_dates_and_photos_smoke(client):
    timeline_response = client.get("/api/v1/timeline/dates")
    assert timeline_response.status_code == 200

    dates = timeline_response.json()
    assert dates["user_id"] >= 1
    assert dates["dates"], "Forventet minst ett aktivt foto i testdatasettet"

    latest_date = dates["dates"][-1]["date"]
    assert latest_date == date(2025, 7, 18).isoformat()

    photos_response = client.get("/api/v1/photos", params={"date": latest_date, "mode": "day"})
    assert photos_response.status_code == 200
    photos_payload = photos_response.json()
    assert photos_payload["count"] == 3
    assert len(photos_payload["photos"]) == 3
    assert photos_payload["photos"][0]["thumbnail_url"] is not None


def test_photos_include_analysis(client):
    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day", "include_analysis": True},
    )
    assert photos_response.status_code == 200
    payload = photos_response.json()
    first = payload["photos"][0]
    assert first["analysis"] is not None
    assert "geometry_method" in first["analysis"]
    assert "confidence" in first["analysis"]


def test_photos_include_coverage_profile(client):
    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert photos_response.status_code == 200
    payload = photos_response.json()
    first = payload["photos"][0]

    assert "coverage_profile" in first
    coverage = first["coverage_profile"]
    assert isinstance(coverage, dict)
    assert set(coverage.keys()) == {
        "planned_front",
        "planned_side",
        "actual_front",
        "actual_side",
        "front_gap",
        "side_gap",
        "neighbor_count",
        "quality",
    }
    assert coverage["planned_front"] == first["overlap_front"]
    assert coverage["planned_side"] == first["overlap_side"]


def test_analysis_actions_and_refresh(client):
    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day", "include_analysis": True},
    )
    assert photos_response.status_code == 200
    payload = photos_response.json()
    photo_id = payload["photos"][0]["id"]

    approve = client.post(f"/api/v1/photos/{photo_id}/approve-analysis")
    assert approve.status_code == 200
    approve_payload = approve.json()
    assert approve_payload["photo_id"] == photo_id
    assert approve_payload["analysis"]["approved"] is True

    recompute = client.post(f"/api/v1/photos/{photo_id}/recompute-analysis")
    assert recompute.status_code == 200
    recompute_payload = recompute.json()
    assert recompute_payload["analysis"]["approved"] is False

    refresh = client.post("/api/v1/analysis/refresh", params={"force": True})
    assert refresh.status_code == 200
    refresh_payload = refresh.json()
    assert refresh_payload["requested"] >= 1
    assert refresh_payload["processed"] >= 1
    assert refresh_payload["failed"] >= 0


def test_photo_metadata_patch(client):
    photos_response = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert photos_response.status_code == 200
    payload = photos_response.json()
    photo_id = payload["photos"][0]["id"]

    patch = client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={
            "tags": ["meen-gard", "test-tag", "test-tag", "  "],
            "caption": "Oppdatert notat",
            "altitude_m": 212.4,
            "heading_deg": -132.6,
            "pitch_deg": -57.0,
            "manual_view_lat": 59.168146,
            "manual_view_lng": 9.662754,
        },
    )
    assert patch.status_code == 200
    patched = patch.json()
    assert patched["photo_id"] == photo_id
    assert "meen-gard" in patched["tags"]
    assert "test-tag" in patched["tags"]
    assert "meta:manual_view_lat=59.168146" in patched["tags"]
    assert "meta:manual_view_lng=9.662754" in patched["tags"]
    assert patched["caption"] == "Oppdatert notat"
    assert patched["altitude_m"] == 212.4
    assert patched["heading_deg"] == -132.6
    assert patched["pitch_deg"] == -57.0
    assert patched["manual_view_lat"] == 59.168146
    assert patched["manual_view_lng"] == 9.662754

    after = client.get(
        "/api/v1/photos",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day"},
    )
    assert after.status_code == 200
    updated_photo = next(item for item in after.json()["photos"] if item["id"] == photo_id)
    assert "meen-gard" in updated_photo["tags"]
    assert "test-tag" in updated_photo["tags"]
    assert "meta:manual_view_lat=59.168146" in updated_photo["tags"]
    assert "meta:manual_view_lng=9.662754" in updated_photo["tags"]
    assert updated_photo["caption"] == "Oppdatert notat"
    assert updated_photo["altitude_m"] == 212.4
    assert updated_photo["heading_deg"] == -132.6
    assert updated_photo["pitch_deg"] == -57.0
    assert updated_photo["view_mode"] == "manual"
    assert updated_photo["view_lat"] == 59.168146
    assert updated_photo["view_lng"] == 9.662754

    clear_patch = client.patch(
        f"/api/v1/photos/{photo_id}/metadata",
        json={"manual_view_lat": None, "manual_view_lng": None},
    )
    assert clear_patch.status_code == 200
    clear_payload = clear_patch.json()
    assert clear_payload["manual_view_lat"] is None
    assert clear_payload["manual_view_lng"] is None
    assert "meta:manual_view_lat=59.168146" not in clear_payload["tags"]
    assert "meta:manual_view_lng=9.662754" not in clear_payload["tags"]


def test_photos_page_smoke(client):
    response = client.get(
        "/api/v1/photos/page",
        params={"date": date(2025, 7, 18).isoformat(), "mode": "day", "limit": 1, "sort": "asc"},
    )
    assert response.status_code == 200
    first = response.json()
    assert first["count"] == 1
    assert first["next_cursor"] is not None

    second = client.get(
        "/api/v1/photos/page",
        params={
            "date": date(2025, 7, 18).isoformat(),
            "mode": "day",
            "limit": 1,
            "sort": "asc",
            "cursor": first["next_cursor"],
        },
    )
    assert second.status_code == 200
    body = second.json()
    assert body["count"] == 1
    assert body["photos"][0]["id"] != first["photos"][0]["id"]


def test_assets_and_logs_smoke(client):
    page = client.get("/api/v1/photos/page", params={"date": date(2025, 7, 18).isoformat(), "mode": "day", "limit": 1}).json()
    assert page["photos"], "Forventet bilder i testpayload"

    photo = page["photos"][0]
    assert photo["thumbnail_url"] is not None

    asset = client.get(photo["thumbnail_url"])
    assert asset.status_code == 200
    assert asset.headers["Cache-Control"] == "public, max-age=31536000, immutable"

    missing = client.get("/api/v1/assets/photos/thumb/does-not-exist.jpg")
    assert missing.status_code == 404

    traversal = client.get("/api/v1/assets/../../etc/passwd")
    assert traversal.status_code in {403, 404}

    logs_response = client.get("/api/v1/logs", params={"limit": 10, "level": "INFO"})
    assert logs_response.status_code == 200
    logs = logs_response.json()
    assert isinstance(logs["source"], str)
    assert "lines" in logs
    assert logs["count"] == len(logs["lines"])

    invalid_level = client.get("/api/v1/logs", params={"level": "NOT_A_LEVEL"})
    assert invalid_level.status_code == 400
