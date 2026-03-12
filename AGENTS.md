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
- `docs/status/` – prosjektstatus og ukentlige notater
- `Linear` – operativ backlog og kontrollflate for agentarbeid
- `GitHub Issues` – historisk backlog og referanser (`https://github.com/henrycmeen/flyvendebonder/issues`)

## Standard arbeidsflyt
1. Legg nytt arbeid i Linear-prosjektet `Flyvendebønder`
2. Løs med små, målbare steg
3. Kjør `./scripts/validate-agent-worktree.sh`
4. Kjør `./scripts/run-stack-smoke.sh` når endringen treffer frontend, routing eller API-overflate
5. Merge til `main` når PR-validering og review er grønt
6. Oppdater status i `docs/status/`

## Lokale kommandoer
- `./scripts/run-web-app-dev.sh` – start backend + frontend (proxy mot backend på port 8787)
- `cd apps/web-app && npm run dev -- --host 127.0.0.1 --port 5173` – kun frontend
- `./scripts/validate-agent-worktree.sh` – standard backend + frontend-validering
- `./scripts/run-stack-smoke.sh` – start lokal backend + preview og kjør smoke-test
- `cd apps/web-app && npm run build` – frontend build
- `./scripts/prepare-webroot.sh` – bygg staging webroot
- `./scripts/deploy-flyvendebonder.sh --dry-run` – valider deploy
- `./scripts/deploy-flyvendebonder.sh` – faktisk deploy

## Agentpilot
- `WORKFLOW.md` er styrende for autonome eller semi-autonome agentløp.
- Linear er nå primær backlog for agentløp, og prosjektet `Flyvendebønder` er kontrollflaten.
- Ikke merge eller deploy automatisk i pilotfasen.
- Unngå endringer i deploy og live-drift uten eksplisitt issue.

## SSH og deploy-tilgang (Mac mini)
- SSH alias `macmini` skal brukes for deploy-kommandoer.
- `~/.ssh/config` skal peke `Host macmini` til `IdentityFile ~/.ssh/macmini`.
- `IdentitiesOnly yes` skal stå på `Host macmini` for å unngå feil nøkkelvalg.
- Hurtigsjekk før deploy: `ssh macmini 'hostname && whoami'`.

## Live deploy fra `main`
- `main` er live-branch for webrooten.
- Push eller merge til `main` trigger GitHub Actions-workflowen `.github/workflows/deploy-main.yml`.
- Workflowen kjører på en self-hosted runner på Mac mini med label `flyvendebonder-live`.
- Runneren sjekker ut repoet lokalt på Mac mini, kjører `npm ci` i `apps/web-app`, og kjører deretter `./scripts/deploy-flyvendebonder.sh --local`.
- Resultatet blir synket til `/Users/henrymeen/srv/www/flyvendebonder/`, som serveres av Caddy.
- Dette betyr at Mac mini ikke serverer direkte fra GitHub. GitHub brukes bare til å trigge workflowen og levere repo-innholdet til runner-jobben.
- Backend deployes ikke automatisk av denne workflowen. `apps/backend-api` kjører fortsatt som egen prosess på Mac mini og håndteres separat.

## Arbeidskopier lokalt
- Mappen over repoet inneholder nå to vanlige git-kloner: `prod/` og `test/`.
- `prod/` skal holdes tett på `origin/main`.
- `test/` brukes til ny branch og pågående arbeid før PR/merge.

## Konvensjoner
- Behold norsk språk i brukergrensesnittet.
- Bruk tydelige norske navn i filer/komponenter der det gir mening, men tekniske konstanter kan være engelske.
- Skriv små komponenter med én hensikt per område.
- Oppdater `docs/status/` når en større visuell eller funksjonell endring går live.
