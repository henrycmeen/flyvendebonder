from __future__ import annotations


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
            "position": {"lat": 59.0006, "lng": 10.0007},
        },
    )
    assert patch_response.status_code == 200
    patched = patch_response.json()
    assert patched["status"] == "done"
    assert patched["priority"] == "normal"
    assert patched["notes"] is None
    assert patched["position"] == {"lat": 59.0006, "lng": 10.0007}


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
