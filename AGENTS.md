# AGENTS.md

## Formål
Dette dokumentet beskriver hvordan vi arbeider med Flyvendebønder-repoet på kort sikt: hva som er bygget nå, hvordan vi dokumenterer status, og hvordan vi holder utviklingen ryddig.

## Struktur
- `apps/info-site/` – nåværende hovedinfoside (`/`)
- `apps/web-app/` – kartsystemet med kart, profil og tidslinje (`/app/`)
- `apps/backend-api/` – FastAPI-backend + database + import og eiendomslags-logikk
- `apps/shared-assets/` – felles logo/ikoner/bilder
- `scripts/` – deploy-steg, import og vedlikehold
- `docs/` – dokumentasjon, drift og planlegging
- `docs/issues/` – backlog og arbeide-issues
- `docs/status/` – prosjektstatus og ukentlige notater

## Standard arbeidsflyt
1. Legg ny arbeid i en issue først (`docs/issues/`)
2. Løs med små, målbare steg
3. Valider med lokal sjekk (frontend build / backend lint om tilgjengelig)
4. Oppdater status i `docs/status/`

## Lokale kommandoer
- `./scripts/run-web-app-dev.sh` – start backend + frontend (proxy mot backend på port 8787)
- `cd apps/web-app && npm run dev -- --host 127.0.0.1 --port 5173` – kun frontend
- `cd apps/web-app && npm run build` – frontend build
- `./scripts/prepare-webroot.sh` – bygg staging webroot
- `./scripts/deploy-flyvendebonder.sh --dry-run` – valider deploy
- `./scripts/deploy-flyvendebonder.sh` – faktisk deploy

## SSH og deploy-tilgang (Mac mini)
- SSH alias `macmini` skal brukes for deploy-kommandoer.
- `~/.ssh/config` skal peke `Host macmini` til `IdentityFile ~/.ssh/macmini`.
- `IdentitiesOnly yes` skal stå på `Host macmini` for å unngå feil nøkkelvalg.
- Hurtigsjekk før deploy: `ssh macmini 'hostname && whoami'`.

## Konvensjoner
- Behold norsk språk i brukergrensesnittet.
- Bruk tydelige norske navn i filer/komponenter der det gir mening, men tekniske konstanter kan være engelske.
- Skriv små komponenter med én hensikt per område.
- Oppdater `docs/status/` når en større visuell eller funksjonell endring går live.
- Nye mapper i `docs/issues/` bør ha kort og tydelig tittel (for eksempel `2026-02` + issue-ID).
