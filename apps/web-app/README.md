# web-app (React + TypeScript + shadcn/ui)

Frontend for `/app/` med:
- Leaflet kart + clustering
- API-drevet timeline
- Profilkort med redigering
- Teknisk logg med request-id
- Automatisk jobId-flyt via backend (ingen manuell knapp)

## Kjør lokalt
```bash
cd apps/web-app
npm install
npm run dev
```

Forutsetter backend på `http://127.0.0.1:8787`.
Vite proxy-er `/api` automatisk i dev.

## Build
```bash
npm run build
```

Bygg output i `apps/web-app/dist` brukes av `scripts/prepare-webroot.sh` og publiseres under `/app/`.
