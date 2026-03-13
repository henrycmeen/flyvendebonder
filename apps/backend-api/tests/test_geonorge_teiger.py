from __future__ import annotations

from types import SimpleNamespace

from app.services.geonorge_teiger import build_field_candidates_from_geojson


def test_build_field_candidates_from_geojson_filters_to_matching_property():
    property_obj = SimpleNamespace(id=1, komm="4003", gnr=70, bnr=17, fnr=0)
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [9.66, 59.17],
                            [9.661, 59.17],
                            [9.661, 59.171],
                            [9.66, 59.171],
                        ]
                    ],
                },
                "properties": {
                    "kommunenummer": "4003",
                    "gardsnummer": 70,
                    "bruksnummer": 17,
                    "festenummer": 0,
                    "lokalid": 42465981,
                    "matrikkelnummertekst": "70/17",
                    "hovedområde": True,
                    "objekttype": "Teig",
                    "nøyaktighetsklasseteig": "Gult",
                    "oppdateringsdato": "2024-01-01T00:00:00",
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [9.67, 59.18],
                            [9.671, 59.18],
                            [9.671, 59.181],
                            [9.67, 59.181],
                        ]
                    ],
                },
                "properties": {
                    "kommunenummer": "4003",
                    "gardsnummer": 71,
                    "bruksnummer": 1,
                    "festenummer": 0,
                    "lokalid": 999,
                    "matrikkelnummertekst": "71/1",
                    "hovedområde": False,
                    "objekttype": "Teig",
                },
            },
        ],
    }

    fields = build_field_candidates_from_geojson(payload, property_obj, sort_mode="property")

    assert len(fields) == 1
    first = fields[0]
    assert first["name"] == "70/17 · hovedteig"
    assert first["local_id"] == 42465981
    assert first["matrikkelnummer"] == "70/17"
    assert first["geometry"]["coordinates"][0][0] == first["geometry"]["coordinates"][0][-1]
    assert first["area_m2"] > 0
    assert first["source_updated_at"] is not None


def test_build_field_candidates_from_geojson_sorts_point_hits_by_distance():
    property_obj = SimpleNamespace(id=1, komm="4003", gnr=70, bnr=17, fnr=0)
    payload = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [9.66, 59.17],
                            [9.661, 59.17],
                            [9.661, 59.171],
                            [9.66, 59.171],
                        ]
                    ],
                },
                "properties": {
                    "kommunenummer": "4003",
                    "gardsnummer": 70,
                    "bruksnummer": 17,
                    "festenummer": 0,
                    "lokalid": 2,
                    "matrikkelnummertekst": "70/17",
                    "meterFraPunkt": 12,
                    "hovedområde": False,
                    "objekttype": "Teig",
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [
                        [
                            [9.662, 59.17],
                            [9.663, 59.17],
                            [9.663, 59.171],
                            [9.662, 59.171],
                        ]
                    ],
                },
                "properties": {
                    "kommunenummer": "4003",
                    "gardsnummer": 70,
                    "bruksnummer": 17,
                    "festenummer": 0,
                    "lokalid": 1,
                    "matrikkelnummertekst": "70/17",
                    "meterFraPunkt": 4,
                    "hovedområde": True,
                    "objekttype": "Teig",
                },
            },
        ],
    }

    fields = build_field_candidates_from_geojson(payload, property_obj, sort_mode="point")

    assert [item["distance_m"] for item in fields] == [4, 12]
    assert fields[0]["name"] == "70/17 · hovedteig"
