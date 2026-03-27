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
- `Linear` – primær arbeidsflate for backlog, prioritering og status (`https://linear.app/henrymeen/project/flyvendebonder-caba5c6a47de`)
- `GitHub Issues` – repo-nære issues og speiling av utvalgte oppgaver (`https://github.com/henrycmeen/flyvendebonder/issues`)

## Standard arbeidsflyt
1. Triager og prioriter arbeid i Linear først når saken trenger prosjektkontekst eller splitting.
2. Kjor repo-naert agentarbeid i Cline Kanban naer oppgaven passer for worktree-basert flyt.
3. Knytt arbeid til GitHub-issue eller PR når endringen er repo-nær og reviewbar.
4. Løs med små, målbare steg.
5. Valider med `./scripts/validate-agent-worktree.sh`, og kjør `./scripts/run-stack-smoke.sh` når overflaten er berørt.
6. Merge til `main` når endringen er klar for live.
7. Oppdater status i `docs/status/` ved større leveranser.

## Lokale kommandoer
- `./scripts/run-web-app-dev.sh` – start backend + frontend (proxy mot backend på port 8787)
- `cd apps/web-app && npm run dev -- --host 127.0.0.1 --port 5173` – kun frontend
- `cd apps/web-app && npm run build` – frontend build
- `./scripts/validate-agent-worktree.sh` – standard backend + frontend-validering
- `./scripts/run-stack-smoke.sh` – lokal stack-smoke for API + frontend
- `./scripts/sync-github-labels.sh` – synk anbefalte GitHub-labels
- `./scripts/prepare-webroot.sh` – bygg staging webroot
- `./scripts/deploy-flyvendebonder.sh --dry-run` – valider deploy
- `./scripts/deploy-flyvendebonder.sh` – faktisk deploy

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

## Agentflate
- `Cline Kanban` er standard lokal agentflate for parallelle worktrees og diff-review.
- `Linear` er fortsatt backlog og prioriteringsflate.
- `GitHub` er fortsatt endelig PR- og mergeflate.

## Konvensjoner
- Behold norsk språk i brukergrensesnittet.
- Bruk tydelige norske navn i filer/komponenter der det gir mening, men tekniske konstanter kan være engelske.
- Skriv små komponenter med én hensikt per område.
- Oppdater `docs/status/` når en større visuell eller funksjonell endring går live.
