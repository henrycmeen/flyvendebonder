# Deploy-flyt for flyvendebønder.no

## Forutsetninger
- SSH alias `macmini` fungerer.
- Remote webroot finnes: `/Users/henrymeen/srv/www/flyvendebonder/`.
- Backend API kjører separat på Mac mini (`127.0.0.1:8787`) bak Caddy `/api/*`.

## Staging
Bygg en lokal staging-kopi med riktig URL-struktur:
- hovedside `/` redirecter til appen
- infoside på `/info/`
- React web-app på `/app/`

```bash
./scripts/prepare-webroot.sh
```

Resultat i:
- `.staging/webroot/index.html` (redirect til `/app/`)
- `.staging/webroot/info/index.html`
- `.staging/webroot/app/index.html`

`prepare-webroot.sh` gjør nå også:
1. `npm install` i `apps/web-app` ved behov.
2. `npm run build` i `apps/web-app`.
3. Kopierer `apps/root-redirect/*` til staging `/`.
4. Kopierer `apps/info-site/*` til staging `/info/`.
5. Kopierer `apps/web-app/dist/*` til staging `/app/`.

## Deploy
### Dry-run
```bash
./scripts/deploy-flyvendebonder.sh --dry-run
```

### Faktisk deploy
```bash
./scripts/deploy-flyvendebonder.sh
```

## Nyttige valg
- Lokal sync (uten SSH):
  ```bash
  ./scripts/deploy-flyvendebonder.sh --local --dest /tmp/flyv-webroot/
  ```
- Egendefinert host/user:
  ```bash
  ./scripts/deploy-flyvendebonder.sh --host macmini --user henrymeen
  ```

## Automatisk live-deploy fra `main`
Repoet har nå workflowen `.github/workflows/deploy-main.yml`.

Den kjører nå både backend og webroot:
1. Kjør ved push til `main` eller manuelt via `workflow_dispatch`.
2. Bruk en self-hosted GitHub Actions-runner på Mac mini.
3. Kjører `npm ci` i `apps/web-app`.
4. Synker backend lokalt på Mac mini med:
   ```bash
   ./scripts/deploy-backend-macmini.sh
   ```
5. Kjører eksisterende webroot-deploy lokalt på Mac mini:
   ```bash
   ./scripts/deploy-flyvendebonder.sh --local --dest /Users/henrymeen/srv/www/flyvendebonder/
   ```

### Hvorfor self-hosted runner
- Du slipper å eksponere SSH på Mac mini for GitHub-hostede runners.
- `main` kan deployes direkte til samme maskin som faktisk server innholdet.
- Både backend og frontend kan deployes på samme maskin med samme filtilgang og launchctl-tilgang.

### Engangsoppsett på Mac mini
1. Gå til repoet på GitHub: `Settings -> Actions -> Runners`.
2. Opprett en self-hosted runner på Mac mini.
3. Gi runneren den faste labelen `flyvendebonder-live`.
4. Kjør runneren som samme bruker som eier webrooten, i praksis `henrymeen`.
5. Verifiser at runneren har tilgang til:
   - repo-checkout
   - `/Users/henrymeen/srv/www/flyvendebonder/`
   - `npm` og vanlig macOS-verktøy som `rsync`

### Viktig avgrensning
- Workflowen synker backend-kode, installerer Python-avhengigheter og restarter `com.flyvendebonder.backend`.
- Webroot publiseres fortsatt separat via `deploy-flyvendebonder.sh`.
- `.env`, `data/`, `logs/` og andre runtime-artefakter beholdes lokalt på Mac mini og overskrives ikke av workflowen.
- Rollback er fortsatt manuell drift dersom deploy skulle feile etter sync.

## Backend runtime på Mac mini
Se:
- `scripts/macos/com.flyvendebonder.backend.plist` (LaunchAgent mal)
- `scripts/caddy/flyvendebonder.Caddyfile.snippet` (Caddy route for `/api/*`)

## URL-kompatibilitet
- Hovedside: `/` redirecter til `/app/`.
- Primær app-url: `/app/`
- Infoside: `/info/`
- Legacy URL: `/demo` og `/demo/*` redirectes med `301` til `/app/` (samme path/query)

## Bilde-optimalisering og backfill
Derivater brukes nå slik:
- `web`: maks side `1600px`, JPEG `quality=82`, `optimize`, `progressive`
- `thumb`: maks side `384px`, JPEG `quality=72`, `optimize`, `progressive`
- `original`: beholdes uendret

Regenerer derivater før publisering (idempotent):
```bash
cd apps/backend-api
python rebuild_derivatives.py --workers 1
```

Trygg test først:
```bash
cd apps/backend-api
python rebuild_derivatives.py --dry-run --limit 20
```

Måling av nåværende lagring/varianter:
```bash
./scripts/stabiliseringsrapport.sh
```

## Publiseringsrekkefølge (runbook)
1. Kjør derivat-backfill:
```bash
cd apps/backend-api
python rebuild_derivatives.py --workers 1
```
2. Restart backend service (LaunchAgent eller manuell restart).
3. Bygg/deploy frontend:
```bash
./scripts/deploy-flyvendebonder.sh --dry-run
./scripts/deploy-flyvendebonder.sh
```
4. Valider:
- `/` redirecter til `/app/`.
- `/app/` åpner uten 404 på assets.
- `/info/` åpner infosiden uten 404 på CSS/video.
- `/api/v1/health` svarer `ok`.
- `GET /api/v1/photos/page?...` returnerer `next_cursor`.
- Asset-respons har forventet `Cache-Control` for `thumb/web` og `original`.

## Smoke-check før deploy
1. Kjør backend-smoketest:
```bash
cd apps/backend-api
python3 -m pytest -q tests/test_smoke.py
```
2. Kjør end-to-end sjekk av API og frontend:
```bash
./scripts/smoke-flyvendebonder.sh
```
