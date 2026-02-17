# Flyvendebønder monorepo

## Struktur
- `apps/info-site/`: produksjonskilde for infosiden (`/`)
- `apps/demo-fotokart/`: statisk demo-app (`/demo/`)
- `apps/shared-assets/`: felles assets (logo/video)
- `docs/`: innsikt, brand og driftsdokumentasjon
- `archive/`: historiske versjoner av tidligere sideoppsett
- `scripts/`: staging og deploy scripts

## Lokal kjøring
1. Bygg staging webroot:
   ```bash
   ./scripts/prepare-webroot.sh
   ```
2. Start lokal server fra staging:
   ```bash
   cd .staging/webroot
   python3 -m http.server 8000
   ```
3. Åpne:
   - `http://localhost:8000/`
   - `http://localhost:8000/demo/`

## Deploy
- Dry-run:
  ```bash
  ./scripts/deploy-flyvendebonder.sh --dry-run
  ```
- Faktisk deploy til macmini:
  ```bash
  ./scripts/deploy-flyvendebonder.sh
  ```

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
