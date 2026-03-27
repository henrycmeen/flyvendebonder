# Flyvendebønder monorepo

## Struktur
- `apps/info-site/`: produksjonskilde for infosiden (`/`)
- `apps/web-app/`: React + TypeScript + shadcn/ui kartapp (`/app/`)
- `apps/demo-fotokart/`: legacy demo (beholdt som referanse)
- `apps/backend-api/`: FastAPI + SQLAlchemy + Alembic + SQLite
- `apps/shared-assets/`: felles assets (logo/video)
- `docs/`: innsikt, brand og driftsdokumentasjon
- `docs/status/`: samlet status på siste funksjoner/arbeid
- `Linear`: arbeidsflate for backlog, prioritering og status (`https://linear.app/henrymeen/project/flyvendebonder-caba5c6a47de`)
- `GitHub Issues`: repo-nære saker og speiling av utvalgte arbeidsoppgaver (`https://github.com/henrycmeen/flyvendebonder/issues`)
- `archive/`: historiske versjoner av tidligere sideoppsett
- `scripts/`: staging og deploy scripts

## Lokal kjøring
Enklest:
```bash
./scripts/run-web-app-dev.sh
```

Dette starter backend + frontend og åpner appen på `http://127.0.0.1:5173/app/`.

Manuelt:
1. Start backend:
   ```bash
   cd apps/backend-api
   python3 -m pip install -r requirements.txt
   python3 server.py
   ```
2. Start frontend:
   ```bash
   cd apps/web-app
   npm install
   npm run dev
   ```
3. Åpne:
  - `http://localhost:5173/app/` (frontend via Vite)
  - API proxied til `http://127.0.0.1:8787`

## Smoke-check før deploy
1. Backend API:
```bash
cd apps/backend-api
python3 -m pytest -q tests/test_smoke.py
```
2. API + frontend-endepunkter:
```bash
./scripts/smoke-flyvendebonder.sh
```

## Standard validering for PR-er
Kjør samme løype lokalt som GitHub Actions bruker:

```bash
./scripts/validate-agent-worktree.sh
```

Kjør full stack-smoke når endringen påvirker frontend, routing eller API-overflate:

```bash
./scripts/run-stack-smoke.sh
```

## Staging/deploy
1. Bygg staging webroot:
   ```bash
   ./scripts/prepare-webroot.sh
   ```
2. Valider lokalt:
   ```bash
   cd .staging/webroot
   python3 -m http.server 8000
   ```
3. Åpne:
   - `http://localhost:8000/`
   - `http://localhost:8000/app/`

## Deploy til Mac mini
- Dry-run:
  ```bash
  ./scripts/deploy-flyvendebonder.sh --dry-run
  ```
- Faktisk deploy til macmini:
  ```bash
  ./scripts/deploy-flyvendebonder.sh
  ```

API ligger under `/api/v1/*` og seed-er `Roar Meen (4003-70/17/0)` automatisk ved første oppstart.

## Bildedata og analyse
- Regenerer demo-data fra dronebilder:
  ```bash
  ./scripts/import-analysebilder-to-demo.py \
    --source "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
    --per-folder 3
  ```
- Kjør enkel metadata-analyse på bildemappen:
  ```bash
  ./scripts/analysebilder-report.sh \
    "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"
  ```
- Kjør utvidet metadata/QC-rapport for heading/pitch/confidence:
  ```bash
  python3 scripts/photo_qc_report.py \
    --source "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
    --pretty
  ```
- Kjør standard QC-kjede (metadata + QC + manifest):
  ```bash
  ./scripts/cycle-metadata-qc.sh \
    "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
    .metadata-qc-runs \
    0
  ```
  Se også: `docs/drift/cli-open-source.md`
- Kjør/oppdater AR5 + jordsmonn-analyse for alle bilder:
  ```bash
  curl -X POST "http://127.0.0.1:8787/api/v1/analysis/refresh?force=true"
  ```

## Processing-pipeline
Backenden har nå et første generelt processing-spor som binder sammen bilder, oppdrag og fremtidige tunge motorer som ODM/WebODM.

- `FlightCapture`: grupperer mange `Photo`-objekter til én prosesserbar flyvning/dataset
- `ProcessingRun`: beskriver én asynkron jobb mot en motor som `webodm` eller senere `odm`
- `ProcessingArtifact`: lagrer output som ortho, DSM, point-cloud, thumbs og rapporter

Anbefalt første motor:
- `webodm` som første API-lag for jobbopprettelse, polling og resultatsporing
- `odm_cli` beholdes som et senere, mer direkte spor for tuning og verts-nær kontroll

Første API-spor:
- `POST /api/v1/flight-captures`
- `GET /api/v1/flight-captures`
- `POST /api/v1/processing-runs`
- `PATCH /api/v1/processing-runs/{id}`
- `POST /api/v1/processing-runs/{id}/artifacts`

Se også: `docs/backend-processing-v0.md`
Se også: `docs/backend-processing-provider-v1.md`

## STAC v1
Flyvendebønder har nå et første STAC-spor for raster- og flight-artefakter.

- `Collection` = én `FlightCapture`
- `Item` = én `ProcessingRun` med `ortho` som hovedasset
- `GeoJSON` beholdes som eksportformat for felt, polygoner og ruter

Endepunkter:
- `GET /api/v1/stac/collections`
- `GET /api/v1/stac/collections/{collection_id}`
- `GET /api/v1/stac/collections/{collection_id}/items`
- `GET /api/v1/stac/collections/{collection_id}/items/{item_id}`

Se også: `docs/drift/stac-contract-v1.md`
