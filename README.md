# Flyvendebønder monorepo

## Struktur
- `apps/info-site/`: produksjonskilde for infosiden (`/`)
- `apps/web-app/`: React + TypeScript + shadcn/ui kartapp (`/app/`)
- `apps/demo-fotokart/`: legacy demo (beholdt som referanse)
- `apps/backend-api/`: FastAPI + SQLAlchemy + Alembic + SQLite
- `apps/shared-assets/`: felles assets (logo/video)
- `docs/`: innsikt, brand og driftsdokumentasjon
- `docs/status/`: samlet status på siste funksjoner/arbeid
- `GitHub Issues`: opprettet i repoet (`https://github.com/henrycmeen/flyvendebonder/issues`)
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
./scripts/validate-agent-worktree.sh
```
2. API + frontend-endepunkter:
```bash
./scripts/run-stack-smoke.sh
```

Dette er også standardløypen for agentarbeid og PR-validering.

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

## GitHub og agentarbeid
- PR-validering ligger i `.github/workflows/pull-request-validate.yml`
- Agentregler ligger i `WORKFLOW.md`
- GitHub Issues brukes fortsatt som backlog
- Praktisk oppsett for pilotfasen er dokumentert i `docs/drift/agentarbeid-flyt.md`

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
