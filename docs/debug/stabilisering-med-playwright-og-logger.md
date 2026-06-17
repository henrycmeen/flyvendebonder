# Stabilisering med Playwright og logger

Dette er standardoppsettet når vi feilsøker live og vil se frontend, nettverk og backend samtidig.

## 1) Følg backendlogger på Mac mini
```bash
./scripts/watch-live-logs.sh
```

Scriptet kobler til `macmini` over SSH og følger:
- `apps/backend-api/logs/backend.log`
- `~/Library/Logs/flyvendebonder-backend.out.log`
- `~/Library/Logs/flyvendebonder-backend.err.log`

## 2) Les backendlogger via API
```bash
COOKIE_JAR="$(mktemp)"
curl -s -c "$COOKIE_JAR" \
  -H 'Content-Type: application/json' \
  -d '{"code":"<admin-kode>"}' \
  'https://xn--flyvendebnder-jnb.no/api/v1/admin/login' | jq
curl -s -b "$COOKIE_JAR" \
  'https://xn--flyvendebnder-jnb.no/api/v1/logs?limit=120&level=WARNING' | jq
rm -f "$COOKIE_JAR"
```

`/api/v1/logs` er nå admin-beskyttet. Dette er nyttig når vi vil hente strukturerte logglinjer med `request_id`.

## 2b) Pakk en debug bundle
Lokal backend:
```bash
./scripts/debug-bundle.sh
```

Mot live-backend:
```bash
BACKEND_URL='https://xn--flyvendebnder-jnb.no' \
ADMIN_ACCESS_CODE='<admin-kode>' \
./scripts/debug-bundle.sh
```

Bundlen samler health, admin-session, logg-endepunkt, runtime-info, lokal backendlogg og `incident-summary.txt` fra `docs/debug/incidents/`.

## 3) Les frontendlogger mens Playwright kjører
Frontend eksponerer nå et debug-API i nettleseren:

```js
window.__flyvDebug.getSnapshot()
```

Tilgjengelige kall:
- `window.__flyvDebug.getClientLogs()`
- `window.__flyvDebug.getDiagnostics()`
- `window.__flyvDebug.getSnapshot()`
- `window.__flyvDebug.clearDiagnostics()`

### Hva som logges i frontend
- globale JS-feil
- unhandled promise rejections
- ressursfeil på bilder/script/stylesheets
- trege API-kall
- retries/timeouts i API-klienten
- lange UI-tasks
- trege statiske ressurslaster

## 4) Hva vi leser i Playwright
Under en stabiliseringsrunde bruker vi typisk fire kilder parallelt:
- Playwright console messages
- Playwright network requests
- `window.__flyvDebug.getSnapshot()`
- `./scripts/watch-live-logs.sh`

Det gir oss:
- frontendfeil
- backendfeil
- request-id-er vi kan følge på tvers
- signaler om treghet i UI eller API

## 5) Praktisk arbeidsmønster
1. Start `./scripts/watch-live-logs.sh` i egen terminal.
2. Åpne siden med Playwright.
3. Reproduser problemet.
4. Les `browser_console_messages`, `browser_network_requests` og `window.__flyvDebug.getSnapshot()`.
5. Match `request_id` mot backendlogg/API-logg.
6. Opprett eller oppdater en incidentfil fra `docs/debug/incidents/TEMPLATE.md`.

## 6) Når noe går tregt
Se etter:
- `Treg API-respons: ...`
- `API timeout: ...`
- `Lang UI-task oppdaget`
- `Treg ressurslast`

Dette er de viktigste signalene for stabilisering mot `1.0`.
