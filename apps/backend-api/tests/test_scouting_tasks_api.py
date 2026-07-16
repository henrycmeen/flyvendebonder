from __future__ import annotations

from datetime import date, datetime


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000 + offset, 59.0000 + offset],
                [10.0018 + offset, 59.0000 + offset],
                [10.0018 + offset, 59.0012 + offset],
                [10.0000 + offset, 59.0012 + offset],
            ]
        ],
    }


def _create_field(client, *, name: str, offset: float = 0.0) -> dict:
    response = client.post(
        "/api/v1/fields",
        json={
            "name": name,
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(offset),
        },
    )
    assert response.status_code == 201
    return response.json()


def _sync_first_unit(client) -> dict:
    response = client.post("/api/v1/planning/properties/1/sync")
    assert response.status_code == 200
    units = response.json()["units"]
    assert units
    return units[0]


def _create_foreign_property_photo(photo_id: str) -> None:
    from app.database import SessionLocal
    from app.models import Photo, Property, User
    from sqlalchemy import select

    with SessionLocal() as db:
        user = db.execute(select(User).order_by(User.id)).scalars().first()
        assert user is not None
        property_obj = Property(
            user_id=user.id,
            komm="3901",
            gnr=99,
            bnr=99,
            fnr=0,
            label="Annen eiendom",
            active_from=date.today(),
            active_to=None,
        )
        db.add(property_obj)
        db.flush()
        db.add(
            Photo(
                id=photo_id,
                user_id=user.id,
                property_id=property_obj.id,
                captured_at=datetime(2025, 7, 18, 12, 0),
                captured_date=date(2025, 7, 18),
                lat=59.2,
                lng=10.2,
                source_filename=f"{photo_id}.jpg",
                source_hash=f"{photo_id}-hash".ljust(64, "0")[:64],
                tags_json="[]",
            )
        )
        db.commit()


def test_scouting_task_can_be_created_listed_and_patched(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(_property_obj):
        return []

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)
    field = _create_field(client, name="Scoutingjordet")
    unit = _sync_first_unit(client)

    create_response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "property_id": 1,
            "field_id": field["id"],
            "planning_unit_id": unit["id"],
            "title": "Sjekk vått hjørne",
            "notes": "Mørkere stripe ved nordenden.",
            "priority": "high",
            "observed_at": "2026-07-16T10:15:00+02:00",
            "position": {"lat": 59.0004, "lng": 10.0005},
            "photo_ids": ["smoke-2025-07-18-00", "smoke-2025-07-18-00"],
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["field_id"] == field["id"]
    assert created["planning_unit_id"] == unit["id"]
    assert created["status"] == "open"
    assert created["priority"] == "high"
    assert created["observed_at"] == "2026-07-16T08:15:00Z"
    assert created["observed_at_original_offset"] == "+02:00"
    assert created["position"] == {"lat": 59.0004, "lng": 10.0005}
    assert created["photo_ids"] == ["smoke-2025-07-18-00"]

    list_response = client.get(f"/api/v1/scouting/tasks?field_id={field['id']}")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["property_id"] == 1
    assert listed["count"] == 1
    assert listed["tasks"][0]["title"] == "Sjekk vått hjørne"

    patch_response = client.patch(
        f"/api/v1/scouting/tasks/{created['id']}",
        json={
            "status": "done",
            "priority": "normal",
            "notes": None,
            "observed_at": "2026-07-16T06:30:00-04:00",
            "position": {"lat": 59.0006, "lng": 10.0007},
        },
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["status"] == "done"
    assert patched["priority"] == "normal"
    assert patched["notes"] is None
    assert patched["observed_at"] == "2026-07-16T10:30:00Z"
    assert patched["observed_at_original_offset"] == "-04:00"
    assert patched["updated_at"] > created["updated_at"]
    assert patched["position"] == {"lat": 59.0006, "lng": 10.0007}

    clear_response = client.patch(
        f"/api/v1/scouting/tasks/{created['id']}",
        json={"observed_at": None},
    )
    assert clear_response.status_code == 200
    cleared = clear_response.json()
    assert cleared["observed_at"] is None
    assert cleared["observed_at_original_offset"] is None


def test_scouting_task_keeps_legacy_observation_time_unknown(client):
    field = _create_field(client, name="Eldre feltfunn")

    response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Tidspunkt ikke kjent",
            "position": {"lat": 59.0004, "lng": 10.0005},
        },
    )

    assert response.status_code == 201
    assert response.json()["observed_at"] is None
    assert response.json()["observed_at_original_offset"] is None


def test_scouting_task_rejects_observation_time_without_offset(client):
    field = _create_field(client, name="Tidssonefelt")

    response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Uklart tidspunkt",
            "observed_at": "2026-07-16T10:15:00",
            "position": {"lat": 59.0004, "lng": 10.0005},
        },
    )

    assert response.status_code == 422
    assert response.json()["error_code"] == "request_validation_error"


def test_scouting_task_rejects_missing_photo_id(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(_property_obj):
        return []

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)
    field = _create_field(client, name="Bildefelt")

    response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Ukjent bilde",
            "position": {"lat": 59.0004, "lng": 10.0005},
            "photo_ids": ["finnes-ikke"],
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Fant ikke valgte bilder: ['finnes-ikke']"


def test_scouting_task_rejects_photo_from_another_property(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(_property_obj):
        return []

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)
    _create_foreign_property_photo("fremmed-bilde")
    field = _create_field(client, name="Riktig felt")

    create_response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Første funn",
            "position": {"lat": 59.0004, "lng": 10.0005},
        },
    )
    assert create_response.status_code == 201

    patch_response = client.patch(
        f"/api/v1/scouting/tasks/{create_response.json()['id']}",
        json={"photo_ids": ["fremmed-bilde"]},
    )
    assert patch_response.status_code == 400
    assert patch_response.json()["detail"] == "Alle bilder på en feltoppgave må tilhøre valgt eiendom: ['fremmed-bilde']"


def test_scouting_task_rejects_planning_unit_from_another_field(client, monkeypatch):
    import app.api.v1 as v1

    async def fake_list_field_candidates_for_property(_property_obj):
        return []

    monkeypatch.setattr(v1, "list_field_candidates_for_property", fake_list_field_candidates_for_property)
    first = _create_field(client, name="Første")
    second = _create_field(client, name="Andre", offset=0.02)

    sync_response = client.post("/api/v1/planning/properties/1/sync")
    assert sync_response.status_code == 200
    units = sync_response.json()["units"]
    second_unit = next(item for item in units if item["source_field_plot_id"] == second["id"])

    response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": first["id"],
            "planning_unit_id": second_unit["id"],
            "title": "Feil scope",
            "position": {"lat": 59.0004, "lng": 10.0005},
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Planenheten tilhører ikke valgt felt"


def test_scouting_task_validates_position(client):
    field = _create_field(client, name="Koordinatjordet")

    response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Ugyldig posisjon",
            "position": {"lat": 95, "lng": 10.0},
        },
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Posisjon må være innenfor gyldige koordinater"
