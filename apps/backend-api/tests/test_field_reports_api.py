from __future__ import annotations


def _sample_polygon() -> dict:
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [10.0000, 59.0000],
                [10.0018, 59.0000],
                [10.0018, 59.0012],
                [10.0000, 59.0012],
            ]
        ],
    }


def _create_report_fixture(client) -> tuple[dict, dict]:
    field_response = client.post(
        "/api/v1/fields",
        json={
            "name": "Pilot <jordet>",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(),
        },
    )
    assert field_response.status_code == 201
    field = field_response.json()

    mission_response = client.post(
        "/api/v1/flight-missions",
        json={
            "name": "Pilotoppdrag",
            "field_ids": [field["id"]],
            "parameters": {
                "altitude_m": 45,
                "line_spacing_m": 18,
                "waypoint_spacing_m": 18,
                "route_angle_deg": 0,
            },
        },
    )
    assert mission_response.status_code == 201
    mission = mission_response.json()

    capture_response = client.post(
        "/api/v1/flight-captures",
        json={
            "mission_id": mission["id"],
            "photo_ids": ["smoke-2025-07-18-00"],
            "notes": "Pilotcapture",
        },
    )
    assert capture_response.status_code == 201
    capture = capture_response.json()

    run_response = client.post(
        "/api/v1/processing-runs",
        json={
            "capture_id": capture["id"],
            "provider": "webodm",
            "requested_outputs": ["ortho"],
        },
    )
    assert run_response.status_code == 201
    run = run_response.json()
    assert client.patch(f"/api/v1/processing-runs/{run['id']}", json={"status": "completed"}).status_code == 200
    assert (
        client.post(
            f"/api/v1/processing-runs/{run['id']}/artifacts",
            json={
                "kind": "ortho",
                "format": "cog",
                "uri": "processing/pilot/ortho.tif",
                "metadata": {"epsg": "EPSG:25832"},
                "provenance": {"provider": "webodm"},
            },
        ).status_code
        == 201
    )

    finding_response = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Sjekk <script>alert(1)</script>",
            "notes": "Vått område & mulig kjøreskade.",
            "priority": "high",
            "position": {"lat": 59.0004, "lng": 10.0005},
            "photo_ids": ["smoke-2025-07-18-00"],
        },
    )
    assert finding_response.status_code == 201
    return field, finding_response.json()


def test_field_report_contract_collects_real_field_evidence(client):
    field, finding = _create_report_fixture(client)

    response = client.get(f"/api/v1/fields/{field['id']}/report")

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    report = response.json()
    assert report["contract"] == {"name": "flyvendebonder.field-report", "version": "v1"}
    assert report["title"] == "Feltrapport – Pilot <jordet>"
    assert report["property"] == {
        "id": field["property_id"],
        "label": "Meen gård",
        "komm": "4003",
        "gnr": 70,
        "bnr": 17,
        "fnr": 0,
    }
    assert report["field"]["id"] == field["id"]
    assert report["field"]["source_provenance"] == {}
    assert report["summary"] == {
        "mission_count": 1,
        "capture_count": 1,
        "processing_run_count": 1,
        "delivery_count": 1,
        "finding_count": 1,
        "open_finding_count": 1,
        "key_photo_count": 1,
        "artifact_kinds": ["ortho"],
    }
    assert report["findings"][0]["id"] == finding["id"]
    assert report["findings"][0]["title"] == "Sjekk <script>alert(1)</script>"
    assert report["findings"][0]["photo_ids"] == ["smoke-2025-07-18-00"]
    assert report["key_photos"][0]["id"] == "smoke-2025-07-18-00"
    assert report["key_photos"][0]["thumbnail_url"].startswith("/api/v1/assets/photos/thumb/")
    assert {entry["kind"] for entry in report["history"]} == {"mission", "capture", "processing_run"}
    assert report["limitations"]


def test_field_report_html_is_print_ready_and_escapes_authored_content(client):
    field, _finding = _create_report_fixture(client)

    response = client.get(f"/api/v1/fields/{field['id']}/report.html")

    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["content-security-policy"].startswith("default-src 'self'")
    assert "@media print" in response.text
    assert "@media (max-width: 480px)" in response.text
    assert "Feltrapport – Pilot &lt;jordet&gt;" in response.text
    assert "Sjekk &lt;script&gt;alert(1)&lt;/script&gt;" in response.text
    assert "Vått område &amp; mulig kjøreskade." in response.text
    assert "Meen gård" in response.text
    assert "4003-70/17" in response.text
    assert "Bekreftet" in response.text
    assert "Manuelt registrert" in response.text
    assert "Bildeserier" in response.text
    assert "Prioritet: Høy" in response.text
    assert " · Bildeserie · " in response.text
    assert "Prosesseringsløp 1" in response.text
    assert "Fullført" in response.text
    assert ">processing_run<" not in response.text
    assert ">completed<" not in response.text
    assert "<script>alert(1)</script>" not in response.text
    assert "/api/v1/assets/photos/web/smoke-2025-07-18-00.jpg" in response.text


def test_field_report_returns_not_found_for_unknown_field(client):
    json_response = client.get("/api/v1/fields/999999/report")
    html_response = client.get("/api/v1/fields/999999/report.html")

    assert json_response.status_code == 404
    assert json_response.json()["detail"] == "Fant ikke felt"
    assert html_response.status_code == 404
    assert html_response.json()["detail"] == "Fant ikke felt"


def test_field_report_supports_empty_field(client):
    field_response = client.post(
        "/api/v1/fields",
        json={
            "name": "Tomt pilotfelt",
            "source": "manual",
            "status": "confirmed",
            "geometry": _sample_polygon(),
        },
    )
    assert field_response.status_code == 201
    field = field_response.json()

    report = client.get(f"/api/v1/fields/{field['id']}/report").json()
    html = client.get(f"/api/v1/fields/{field['id']}/report.html").text

    assert report["summary"]["finding_count"] == 0
    assert report["summary"]["key_photo_count"] == 0
    assert report["findings"] == []
    assert report["key_photos"] == []
    assert "Ingen registrerte feltfunn." in html
    assert "Ingen nøkkelbilder er knyttet til funnene." in html


def test_field_report_deduplicates_photo_linked_to_multiple_findings(client):
    field, _finding = _create_report_fixture(client)
    second_finding = client.post(
        "/api/v1/scouting/tasks",
        json={
            "field_id": field["id"],
            "title": "Samme nøkkelbilde, nytt funn",
            "priority": "normal",
            "position": {"lat": 59.0006, "lng": 10.0007},
            "photo_ids": ["smoke-2025-07-18-00"],
        },
    )
    assert second_finding.status_code == 201

    report = client.get(f"/api/v1/fields/{field['id']}/report").json()

    assert report["summary"]["finding_count"] == 2
    assert report["summary"]["key_photo_count"] == 1
    assert [photo["id"] for photo in report["key_photos"]] == ["smoke-2025-07-18-00"]


def test_field_report_uses_stored_photo_asset_paths_and_original_fallback(client):
    field, _finding = _create_report_fixture(client)

    from app.config import get_settings
    from app.database import SessionLocal
    from app.models import PhotoAsset
    from sqlalchemy import select

    settings = get_settings()
    with SessionLocal() as db:
        web_asset = db.execute(
            select(PhotoAsset).where(
                PhotoAsset.photo_id == "smoke-2025-07-18-00",
                PhotoAsset.kind == "web",
            )
        ).scalar_one()
        source_path = settings.app_data_root / web_asset.path
        custom_path = "report-assets/pilot-original.jpg"
        target_path = settings.app_data_root / custom_path
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(source_path.read_bytes())
        web_asset.kind = "original"
        web_asset.path = custom_path
        db.commit()

    report = client.get(f"/api/v1/fields/{field['id']}/report").json()

    assert report["key_photos"][0]["thumbnail_url"] == (
        "/api/v1/assets/photos/thumb/smoke-2025-07-18-00.jpg"
    )
    assert report["key_photos"][0]["web_url"] == "/api/v1/assets/report-assets/pilot-original.jpg"
    assert client.get(report["key_photos"][0]["web_url"]).status_code == 200


def test_field_report_only_lists_artifacts_from_completed_processing_runs(client):
    field, _finding = _create_report_fixture(client)
    initial_report = client.get(f"/api/v1/fields/{field['id']}/report").json()
    capture_id = next(entry["capture_id"] for entry in initial_report["history"] if entry["kind"] == "capture")

    queued_run_response = client.post(
        "/api/v1/processing-runs",
        json={
            "capture_id": capture_id,
            "provider": "webodm",
            "requested_outputs": ["dsm"],
        },
    )
    assert queued_run_response.status_code == 201
    queued_run = queued_run_response.json()
    assert (
        client.post(
            f"/api/v1/processing-runs/{queued_run['id']}/artifacts",
            json={
                "kind": "dsm",
                "format": "cog",
                "uri": "processing/pilot/dsm-incomplete.tif",
                "metadata": {},
                "provenance": {"provider": "webodm"},
            },
        ).status_code
        == 201
    )

    report = client.get(f"/api/v1/fields/{field['id']}/report").json()

    assert report["summary"]["processing_run_count"] == 2
    assert report["summary"]["delivery_count"] == 1
    assert report["summary"]["artifact_kinds"] == ["ortho"]
