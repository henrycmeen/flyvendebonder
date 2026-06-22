# Backend API (FastAPI)

Backend for Flyvendebønder med:
- FastAPI
- SQLAlchemy modeller
- Alembic migreringer
- SQLite (første steg)
- Auto-seed av Roar Meen + Meen-gård bilder fra eksisterende demo-datasett
- Gårdskart jobId-cache i backend

## Start lokalt
```bash
cd apps/backend-api
python3 -m pip install -r requirements.txt
python3 server.py
```

API: `http://127.0.0.1:8787/api/v1`

## Kjør smoke-test lokalt
```bash
cd apps/backend-api
python3 -m pip install -r requirements.txt
python3 -m pytest -q tests/test_smoke.py
```

## Viktige endepunkter
- `GET /api/v1/health`
- `GET /api/v1/profile/current`
- `PATCH /api/v1/profile/current`
- `GET /api/v1/timeline/dates`
- `GET /api/v1/photos?date=YYYY-MM-DD&mode=day|cumulative`
- `PATCH /api/v1/photos/{photo_id}/metadata`
- `GET /api/v1/properties/current`
- `GET /api/v1/properties/current/gardskart-job`
- `GET /api/v1/properties/current/field-candidates` returnerer også provenance-feltene `source_endpoint`, `source_fetched_at` og `source_updated_at` per kandidat.
- `GET /api/v1/sources/status` viser om AR5, Gårdskart og jordsmonn/jordkvalitet er aktivert eller deaktivert i miljøet.
- `POST /api/v1/imports/photos`
- `GET /api/v1/imports/{id}`
- `GET /api/v1/assets/{asset_path}`

## Import av nye bilder
CLI (manuell jobb):
```bash
cd apps/backend-api
python3 import_photos.py "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"
```

## Notes
- Databasen ligger i `apps/backend-api/data/flyvendebonder.db`.
- Ved funn av legacy/halv-migrert DB tar backend automatisk backup og migrerer på nytt.
- `gardskart-job` endpoint fornyer jobId automatisk når cache er utløpt, men NIBIO Gårdskart er deaktivert som sikker default. Sett `NIBIO_GARDSKART_ENABLED=true` bare i miljø med avklart tilgang.

## AR5 + jordsmonn (v0.1)
- Analyse beriker bilder med `ar5_class` og `soil_class`.
- Oppslagspunkt følger samme geometri som vises i appen (`view_lat/view_lng`-logikk), med fallback til dronepunkt.
- Kildepolicyen ligger i `docs/drift/kildepolicy-v1.md`. Kortversjonen er at Geonorge brukes som primær felt-/teigkilde, mens NIBIO-lag brukes som overlay eller analysekontekst.
- Standardoppsett kan bruke NIBIO WMS `GetFeatureInfo`, men AR5/Gårdskart-avhengigheter behandles som rettighetsstyrte i bred distribusjon:
  - AR5: `https://wms.nibio.no/cgi-bin/ar5` (`Arealtype`)
  - Jordkvalitet: `https://wms.nibio.no/cgi-bin/jordkvalitet` (`Jordkvalitet`)
- WFS brukes som fallback der det er konfigurert.
- AR5-oppslag er deaktivert som sikker default med `PHOTO_AR5_ENABLED=false`. Sett `PHOTO_AR5_ENABLED=true` bare i miljø med avklart Geovekst/Norge Digitalt-tilgang.
- `GET /api/v1/sources/status` kan brukes i drift/smoke for å se om AR5, Gårdskart og jordsmonn/jordkvalitet faktisk er aktivt.

Nyttige env-variabler:
- `PHOTO_AR5_ENABLED`
- `PHOTO_AR5_WMS_URL`
- `PHOTO_AR5_WMS_LAYERS`
- `PHOTO_AR5_WMS_LAYER_FIELDS`
- `PHOTO_SOIL_WMS_URL`
- `PHOTO_SOIL_WMS_LAYERS`
- `PHOTO_SOIL_WMS_LAYER_FIELDS`
- `PHOTO_AR5_WFS_URL`
- `PHOTO_AR5_WFS_LAYERS`
- `PHOTO_SOIL_WFS_URL`
- `PHOTO_SOIL_WFS_LAYERS`

Tving reanalyse av alle bilder:
```bash
curl -X POST "http://127.0.0.1:8787/api/v1/analysis/refresh?force=true"
```

Reparse original metadata og rebygg analyse i samme pass:
```bash
curl -X POST "http://127.0.0.1:8787/api/v1/maintenance/reprocess-photos?refresh_analysis=true&force_analysis=true"
```
