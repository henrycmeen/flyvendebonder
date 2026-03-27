from __future__ import annotations


def _sample_polygon(offset: float = 0.0) -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000 + offset, 59.0000 + offset],
                [10.0012 + offset, 59.0000 + offset],
                [10.0012 + offset, 59.0009 + offset],
                [10.0000 + offset, 59.0009 + offset],
            ]
        ],
    }


def test_field_plots_empty_by_default(client):
    response = client.get("/api/v1/fields")

    assert response.status_code == 200
    payload = response.json()
    assert payload["count"] == 0
    assert payload["fields"] == []


def test_field_plot_roundtrip(client):
    create_response = client.post(
        "/api/v1/fields",
        json={
            "source": "manual",
            "status": "draft",
            "geometry": _sample_polygon(),
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()
    assert created["name"].startswith("Jordutkast ")
    assert created["status"] == "draft"
    assert created["source"] == "manual"
    assert created["area_m2"] > 0
    assert created["geometry"]["coordinates"][0][0] == created["geometry"]["coordinates"][0][-1]

    listing = client.get("/api/v1/fields")
    assert listing.status_code == 200
    listed = listing.json()
    assert listed["count"] == 1
    assert listed["fields"][0]["id"] == created["id"]

    update_response = client.patch(
        f"/api/v1/fields/{created['id']}",
        json={
            "name": "Nordjordet",
            "status": "confirmed",
            "geometry": _sample_polygon(0.001),
        },
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["name"] == "Nordjordet"
    assert updated["status"] == "confirmed"
    assert updated["area_m2"] > 0

    delete_response = client.delete(f"/api/v1/fields/{created['id']}")
    assert delete_response.status_code == 200
    assert delete_response.json() == {"status": "deleted", "field_id": created["id"]}

    after_delete = client.get("/api/v1/fields")
    assert after_delete.status_code == 200
    assert after_delete.json()["count"] == 0


def test_field_plot_rejects_too_small_polygon(client):
    response = client.post(
        "/api/v1/fields",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [10.0, 59.0],
                        [10.0000001, 59.0],
                        [10.0000001, 59.0000001],
                    ]
                ],
            }
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Polygonet er for lite til å lagres som jordutkast"


def test_field_plot_rejects_invalid_coordinate_range(client):
    response = client.post(
        "/api/v1/fields",
        json={
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [200.0, 59.0],
                        [10.0012, 59.0],
                        [10.0012, 59.0009],
                    ]
                ],
            }
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Koordinater er utenfor gyldig område"


def test_field_plot_geojson_export_includes_contract_metadata(client):
    create_response = client.post(
        "/api/v1/fields",
        json={
            "name": "Nordjordet",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(),
        },
    )
    assert create_response.status_code == 201
    created = create_response.json()

    export_response = client.get("/api/v1/fields/export.geojson")
    assert export_response.status_code == 200
    assert export_response.headers["content-type"].startswith("application/geo+json")
    payload = export_response.json()
    assert payload["type"] == "FeatureCollection"
    assert payload["flyvendebonder_contract"]["name"] == "flyvendebonder.geojson"
    assert payload["flyvendebonder_contract"]["version"] == "v1"
    assert payload["flyvendebonder_contract"]["coordinate_reference_system"] == "OGC:CRS84"
    assert payload["features"][0]["properties"]["field_id"] == created["id"]
    assert payload["features"][0]["properties"]["status"] == "confirmed"
