# Info-site (`/info/`)

Produksjonskilde for infosiden.

## Kjøring lokalt
Info-site er laget for å kjøres via staging-webroot, slik at `/info/`, `/assets/` og `/app/` matcher produksjon.

```bash
./scripts/prepare-webroot.sh
cd .staging/webroot
python3 -m http.server 8000
```

Åpne `http://localhost:8000/info/`.
