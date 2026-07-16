from __future__ import annotations

from datetime import datetime


def _polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [[
            [10.0 + offset, 59.0 + offset],
            [10.002 + offset, 59.0 + offset],
            [10.002 + offset, 59.002 + offset],
            [10.0 + offset, 59.002 + offset],
        ]],
    }


def _candidate(*, local_id: int = 2, offset: float = 0.05) -> dict:
    return {
        "source": "geonorge",
        "source_endpoint": "/punkt/omrader",
        "source_fetched_at": datetime(2026, 7, 16, 8, 0, 0),
        "source_updated_at": datetime(2025, 4, 3, 0, 0, 0),
        "name": f"70/28 · teig {local_id}",
        "local_id": local_id,
        "matrikkelnummer": "70/28",
        "object_type": "Teig",
        "accuracy_class": "Gult",
        "is_main_area": local_id == 2,
        "distance_m": local_id + 2,
        "geometry": _polygon(offset),
        "area_m2": 5200.0,
        "area_ha": 0.52,
        "property_ref": {
            "komm": "4003",
            "gnr": 70,
            "bnr": 28,
            "fnr": 0,
            "label": "70/28",
        },
    }


def _counts():
    from app.database import SessionLocal
    from app.models import FieldPlot, PlanningUnit, Property
    from sqlalchemy import func, select

    with SessionLocal() as db:
        return tuple(
            db.scalar(select(func.count()).select_from(model))
            for model in (Property, FieldPlot, PlanningUnit)
        )


def test_preview_returns_all_candidates_without_writes_or_owner_data(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup(**_kwargs):
        return [_candidate(), _candidate(local_id=3, offset=0.08)]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    client.cookies.clear()
    before = _counts()

    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 2
    assert len({item["candidate_id"] for item in payload["candidates"]}) == 2
    assert payload["candidates"][0]["property_ref"] == {
        "komm": "4003", "gnr": 70, "bnr": 28, "fnr": 0, "label": "70/28"
    }
    assert payload["candidates"][0]["existing"] is None
    assert payload["owner_information_available"] is False
    assert "owner_name" not in payload["candidates"][0]
    assert _counts() == before


def test_preview_keeps_valid_candidates_when_one_upstream_candidate_is_malformed(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup(**_kwargs):
        return [{"source": "geonorge", "name": "Ufullstendig teig"}, _candidate()]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)

    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1
    assert response.json()["candidates"][0]["property_ref"]["label"] == "70/28"


def test_preview_fails_cleanly_when_all_upstream_candidates_are_malformed(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup(**_kwargs):
        return [{"source": "geonorge", "name": "Ufullstendig teig"}]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)

    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )

    assert response.status_code == 502
    assert response.json()["detail"] == (
        "Eiendomsoppslaget returnerte ufullstendige data. Prøv et annet punkt."
    )


def test_confirm_requires_admin_and_rejects_stale_candidate(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup(**_kwargs):
        return [_candidate()]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    preview = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    ).json()
    candidate_id = preview["candidates"][0]["candidate_id"]
    client.cookies.clear()
    before = _counts()

    unauthorized = client.put(
        f"/api/v1/operating-areas/{candidate_id}",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60, "operating_relation": "leased"},
    )
    assert unauthorized.status_code == 401
    assert _counts() == before

    assert client.post("/api/v1/admin/login", json={"code": "test-admin-code"}).status_code == 200
    stale = client.put(
        f"/api/v1/operating-areas/{'0' * 64}",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60, "operating_relation": "leased"},
    )
    assert stale.status_code in {404, 409}
    assert _counts() == before


def test_confirm_leased_is_idempotent_and_visible_in_profile_and_planning(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_lookup(**_kwargs):
        return [_candidate()]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    request = {"lat": 59.0, "lng": 10.0, "radius_m": 60}
    preview = client.post("/api/v1/operating-area-previews", json=request).json()
    candidate_id = preview["candidates"][0]["candidate_id"]

    first = client.put(
        f"/api/v1/operating-areas/{candidate_id}",
        json={**request, "operating_relation": "leased"},
    )
    assert first.status_code == 200
    first_payload = first.json()
    assert first_payload["property_created"] is True
    assert first_payload["field_created"] is True
    assert first_payload["planning_units_created"] == 1
    assert first_payload["property"]["operating_relation"] == "leased"
    assert first_payload["field"]["source_provenance"]["candidate_id"] == candidate_id

    second = client.put(
        f"/api/v1/operating-areas/{candidate_id}",
        json={**request, "operating_relation": "leased"},
    )
    assert second.status_code == 200
    second_payload = second.json()
    assert second_payload["property"]["id"] == first_payload["property"]["id"]
    assert second_payload["field"]["id"] == first_payload["field"]["id"]
    assert second_payload["property_created"] is False
    assert second_payload["field_created"] is False
    assert second_payload["planning_units_created"] == 0
    assert _counts()[1:] == (1, 1)

    profile = client.get("/api/v1/profile/current").json()
    added = next(item for item in profile["additional_properties"] if item["bnr"] == 28)
    assert added["operating_relation"] == "leased"
    planning = client.get(f"/api/v1/planning/properties/{added['id']}/units").json()
    assert planning["count"] == 1

    existing_preview = client.post("/api/v1/operating-area-previews", json=request).json()
    assert existing_preview["candidates"][0]["existing"]["property_id"] == added["id"]
    assert existing_preview["candidates"][0]["existing"]["operating_relation"] == "leased"


def test_confirm_selected_candidate_not_first_and_supports_all_relations(client, monkeypatch):
    import app.api.v1 as v1

    candidates = [_candidate(), _candidate(local_id=3, offset=0.08)]

    async def fake_lookup(**_kwargs):
        return candidates

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    request = {"lat": 59.0, "lng": 10.0, "radius_m": 60}
    preview = client.post("/api/v1/operating-area-previews", json=request).json()
    selected = preview["candidates"][1]

    response = client.put(
        f"/api/v1/operating-areas/{selected['candidate_id']}",
        json={**request, "operating_relation": "owned"},
    )
    assert response.status_code == 200
    assert response.json()["field"]["name"].endswith("teig 3")

    unknown = client.put(
        f"/api/v1/operating-areas/{selected['candidate_id']}",
        json={**request, "operating_relation": "unknown"},
    )
    assert unknown.status_code == 200
    assert unknown.json()["property"]["operating_relation"] == "unknown"


def test_preview_never_exposes_another_users_existing_connection(client, monkeypatch):
    import app.api.v1 as v1
    from app.database import SessionLocal
    from app.models import FieldPlot, Property, User
    from app.services.operating_areas import candidate_source_key
    import json

    candidate = _candidate()
    with SessionLocal() as db:
        other = User(full_name="Annen bonde")
        db.add(other)
        db.flush()
        other_property = Property(
            user_id=other.id,
            komm="4003",
            gnr=70,
            bnr=28,
            fnr=0,
            operating_relation="leased",
        )
        db.add(other_property)
        db.flush()
        db.add(
            FieldPlot(
                property_id=other_property.id,
                name="Annen brukers teig",
                source="imported",
                source_key=candidate_source_key(candidate),
                status="draft",
                geometry_json=json.dumps(candidate["geometry"]),
                source_provenance_json="{}",
            )
        )
        db.commit()

    async def fake_lookup(**_kwargs):
        return [candidate]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert response.status_code == 200
    assert response.json()["candidates"][0]["existing"] is None


def test_updated_upstream_geometry_reuses_stable_field_without_resetting_planning(client, monkeypatch):
    import app.api.v1 as v1

    current = _candidate()

    async def fake_lookup(**_kwargs):
        return [current]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    request = {"lat": 59.0, "lng": 10.0, "radius_m": 60}
    first_preview = client.post("/api/v1/operating-area-previews", json=request).json()
    first = client.put(
        f"/api/v1/operating-areas/{first_preview['candidates'][0]['candidate_id']}",
        json={**request, "operating_relation": "leased"},
    ).json()

    current = {**current, "geometry": _polygon(0.051)}
    changed_preview = client.post("/api/v1/operating-area-previews", json=request).json()
    assert changed_preview["candidates"][0]["candidate_id"] != first_preview["candidates"][0]["candidate_id"]
    assert changed_preview["candidates"][0]["existing"]["field_id"] == first["field"]["id"]

    changed = client.put(
        f"/api/v1/operating-areas/{changed_preview['candidates'][0]['candidate_id']}",
        json={**request, "operating_relation": "leased"},
    )
    assert changed.status_code == 200
    changed_payload = changed.json()
    assert changed_payload["field"]["id"] == first["field"]["id"]
    assert changed_payload["field"]["geometry"]["coordinates"][0][0] == current["geometry"]["coordinates"][0][0]
    assert changed_payload["planning_units"][0]["geometry"] == changed_payload["field"]["geometry"]
    assert [unit["id"] for unit in changed_payload["planning_units"]] == [
        unit["id"] for unit in first["planning_units"]
    ]
    assert changed_payload["field_created"] is False
    assert changed_payload["planning_units_created"] == 0
    assert _counts()[1:] == (1, 1)


def test_preview_and_confirm_fail_cleanly_for_no_match_and_upstream_error(client, monkeypatch):
    import app.api.v1 as v1

    async def no_match(**_kwargs):
        return []

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", no_match)
    before = _counts()
    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert response.status_code == 404
    assert _counts() == before

    async def upstream_error(**_kwargs):
        raise TimeoutError("secret upstream detail")

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", upstream_error)
    response = client.post(
        "/api/v1/operating-area-previews",
        json={"lat": 59.0, "lng": 10.0, "radius_m": 60},
    )
    assert response.status_code == 502
    assert "secret" not in response.text.lower()
    assert _counts() == before


def test_candidate_without_local_id_uses_consistent_fallback_identity(client, monkeypatch):
    import app.api.v1 as v1

    candidate = {**_candidate(), "local_id": None, "is_main_area": False}

    async def fake_lookup(**_kwargs):
        return [candidate]

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    request = {"lat": 59.0, "lng": 10.0, "radius_m": 60}
    preview = client.post("/api/v1/operating-area-previews", json=request)
    assert preview.status_code == 200
    candidate_id = preview.json()["candidates"][0]["candidate_id"]

    confirmed = client.put(
        f"/api/v1/operating-areas/{candidate_id}",
        json={**request, "operating_relation": "unknown"},
    )
    assert confirmed.status_code == 200
    repeated = client.put(
        f"/api/v1/operating-areas/{candidate_id}",
        json={**request, "operating_relation": "unknown"},
    )
    assert repeated.status_code == 200
    assert repeated.json()["field"]["id"] == confirmed.json()["field"]["id"]


def test_distinct_candidates_without_local_ids_do_not_collapse(client, monkeypatch):
    import app.api.v1 as v1

    candidates = [
        {**_candidate(), "local_id": None, "is_main_area": False},
        {**_candidate(offset=0.08), "local_id": None, "is_main_area": False},
    ]

    async def fake_lookup(**_kwargs):
        return candidates

    monkeypatch.setattr(v1, "lookup_field_candidates_by_point_any", fake_lookup)
    request = {"lat": 59.0, "lng": 10.0, "radius_m": 60}
    preview = client.post("/api/v1/operating-area-previews", json=request).json()
    assert len({item["candidate_id"] for item in preview["candidates"]}) == 2

    first = client.put(
        f"/api/v1/operating-areas/{preview['candidates'][0]['candidate_id']}",
        json={**request, "operating_relation": "leased"},
    ).json()
    second = client.put(
        f"/api/v1/operating-areas/{preview['candidates'][1]['candidate_id']}",
        json={**request, "operating_relation": "leased"},
    ).json()
    assert first["field"]["id"] != second["field"]["id"]
    assert _counts()[1:] == (2, 2)
