# Backend drift på Mac mini

## 1) Installer avhengigheter
```bash
cd /Users/henrymeen/srv/apps/flyvendebonder
python3 -m venv .venv
./.venv/bin/pip install -r apps/backend-api/requirements.txt
```

## 2) Test lokal oppstart
```bash
cd /Users/henrymeen/srv/apps/flyvendebonder/apps/backend-api
../../.venv/bin/python server.py
```

Health:
```bash
curl -s http://127.0.0.1:8787/api/v1/health
```

## 2b) Admin-kode for skriveoperasjoner
Skriveoperasjoner som import, metadataendringer og profiloppdatering er nå låst bak admin-sesjon. Sett dette på Mac mini før deploy:

```bash
cat > /Users/henrymeen/srv/apps/flyvendebonder/apps/backend-api/.env <<'EOF'
ADMIN_ACCESS_CODE=velg-en-lang-hemmelig-kode
ADMIN_SESSION_SECRET=velg-en-egen-lang-hemmelig-secret
EOF
```

`ADMIN_SESSION_SECRET` bør være forskjellig fra selve koden. Etter endring i `.env`, restart backend-tjenesten.

## 3) LaunchAgent
1. Kopier og juster stier i `scripts/macos/com.flyvendebonder.backend.plist`.
2. Legg filen i `~/Library/LaunchAgents/com.flyvendebonder.backend.plist`.
3. Last inn tjenesten:
   ```bash
   launchctl unload ~/Library/LaunchAgents/com.flyvendebonder.backend.plist 2>/dev/null || true
   launchctl load ~/Library/LaunchAgents/com.flyvendebonder.backend.plist
   launchctl start com.flyvendebonder.backend
   ```

Sjekk status:
```bash
launchctl list | rg flyvendebonder
```

## 4) Caddy
Legg inn route fra `scripts/caddy/flyvendebonder.Caddyfile.snippet` i Caddyfile.

Valider og reload:
```bash
/opt/homebrew/opt/caddy/bin/caddy validate --config /opt/homebrew/etc/Caddyfile
/opt/homebrew/opt/caddy/bin/caddy reload --config /opt/homebrew/etc/Caddyfile
```

## 5) Logging
- stdout: `~/Library/Logs/flyvendebonder-backend.out.log`
- stderr: `~/Library/Logs/flyvendebonder-backend.err.log`
- App-logg på disk: `apps/backend-api/logs/backend.log` (rotasjon via `RotatingFileHandler`)

Hente siste backendlogg via API:
```bash
curl -s http://127.0.0.1:8787/api/v1/logs?limit=120 | jq
```

- `limit`: antall linjer (1–1000)
- `level`: `DEBUG|INFO|WARNING|ERROR|CRITICAL` (valgfritt)

Følge live-logger fra utviklingsmaskinen:
```bash
./scripts/watch-live-logs.sh
```

For kombinert frontend/backend-feilsøking med Playwright, se `docs/debug/stabilisering-med-playwright-og-logger.md`.

## 6) Backup (SQLite)
Eksempel daglig snapshot:
```bash
mkdir -p ~/backups/flyvendebonder
cp /Users/henrymeen/srv/apps/flyvendebonder/apps/backend-api/data/flyvendebonder.db \
  ~/backups/flyvendebonder/flyvendebonder-$(date +%F).db
```
