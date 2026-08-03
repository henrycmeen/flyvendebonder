# AGENTS.md

Les også `PROJECT_AUTONOMY.md`. Begge filer gjelder; den strengeste regelen vinner.

## Formål
Dette dokumentet beskriver hvordan vi arbeider med Flyvendebønder-repoet på kort sikt: hva som er bygget nå, hvordan vi dokumenterer status, og hvordan vi holder utviklingen ryddig.

## Struktur
- `apps/root-redirect/` – enkel redirect fra hovedsiden (`/`) til appen (`/app/`)
- `apps/info-site/` – infosiden (`/info/`)
- `apps/web-app/` – kartsystemet med kart, profil og tidslinje (`/app/`)
- `apps/backend-api/` – FastAPI-backend + database + import og eiendomslags-logikk
- `apps/shared-assets/` – felles logo/ikoner/bilder
- `scripts/` – deploy-steg, import og vedlikehold
- `docs/` – dokumentasjon, drift og planlegging
- `docs/status/` – prosjektstatus og ukentlige notater
- `GitHub Issues` – primær arbeidsflate for backlog, prioritering og status (`https://github.com/henrycmeen/flyvendebonder/issues`)

## Standard arbeidsflyt
1. Triager og prioriter arbeid i GitHub Issues først.
2. Bruk GitHub milestones som prioriteringsrekkefølge; ikke bruk egne prioritet-labels.
3. Kjor parallelle Codex-oppgaver i egne worktrees med tydelig branch- og fileierskap.
4. Knytt arbeid til GitHub-issue og PR når endringen er repo-nær og reviewbar.
5. Løs med små, målbare steg.
6. Valider med `./scripts/validate-agent-worktree.sh`, og kjør `./scripts/run-stack-smoke.sh` når overflaten er berørt.
7. Merge til `main` når endringen er klar for live.
8. Oppdater status i `docs/status/` ved større leveranser.

## Lokale kommandoer
- `./scripts/run-web-app-dev.sh` – start backend + frontend (proxy mot backend på port 8787)
- `cd apps/web-app && npm run dev -- --host 127.0.0.1 --port 5173` – kun frontend
- `cd apps/web-app && npm run build` – frontend build
- `./scripts/setup-project-storage-link.sh` – opprett maskinlokal `project-storage/`-snarvei til prosjektlagringen når `Projects`-disken er montert
- `./scripts/validate-agent-worktree.sh` – standard backend + frontend-validering
- `./scripts/run-stack-smoke.sh` – lokal stack-smoke for API + frontend
- `./scripts/sync-github-labels.sh` – synk anbefalte GitHub-labels
- `./scripts/prepare-webroot.sh` – bygg staging webroot
- `./scripts/deploy-flyvendebonder.sh --dry-run` – valider deploy
- `./scripts/deploy-flyvendebonder.sh` – faktisk deploy

## Lokal prosjektlagring

- Git-repo, `.git`, aktiv kildekode og lokale endringer skal ligge på intern SSD.
- På privat Mac mini ligger store runtime-cacher og prosjektdata under `/Volumes/Projects/Active/Flyvendebonder/`.
- Bruk `project-storage/` i reporoten som maskinlokal snarvei. Opprett eller verifiser den med `./scripts/setup-project-storage-link.sh`.
- Store datasett/importgrunnlag, dronebilder/video og genererte leveranser skal normalt legges i `project-storage/data/`, `project-storage/media/` og `project-storage/exports/`, ikke i Git-repoet.
- Før installasjon, build, test eller smoke: verifiser at `/Volumes/Projects` er montert, at prosjektroten finnes og at forventede symlinkmål løser.
- Hvis en `node_modules`- eller `.venv`-symlink er dangling, stopp. Ikke installer en ny intern cache før riktig disk er montert eller Henry uttrykkelig har valgt en ny bootstrap.
- Ekstern lagring er arbeidslagring, ikke eneste sikkerhetskopi. Uerstattelige rådata og medier må ha en separat kopi.
- Se `docs/drift/local-project-storage.md` for struktur, oppsett og sikkerhetsregler.

## SSH og deploy-tilgang (Mac mini)
- SSH alias `macmini` skal brukes for deploy-kommandoer.
- `~/.ssh/config` skal peke `Host macmini` til `IdentityFile ~/.ssh/macmini`.
- `IdentitiesOnly yes` skal stå på `Host macmini` for å unngå feil nøkkelvalg.
- Hurtigsjekk før deploy: `ssh macmini 'hostname && whoami'`.

## Live deploy fra `main`
- `main` er live-branch for webrooten og backend-koden.
- Push eller merge til `main` trigger GitHub Actions-workflowen `.github/workflows/deploy-main.yml`.
- Workflowen kjører på en self-hosted runner på Mac mini med label `flyvendebonder-live`.
- Runneren sjekker ut repoet lokalt på Mac mini, kjører `npm ci` i `apps/web-app`, og deployer deretter backend og webroot lokalt.
- Backend-steg: `./scripts/deploy-backend-macmini.sh` synker `apps/backend-api` til `/Users/henrymeen/srv/apps/flyvendebonder/apps/backend-api`, installerer Python-avhengigheter, restarter `com.flyvendebonder.backend`, og health-sjekker `127.0.0.1:8787`.
- Webroot-steg: `./scripts/deploy-flyvendebonder.sh --local` bygger staging og synker til `/Users/henrymeen/srv/www/flyvendebonder/`, som serveres av Caddy.
- Dette betyr at Mac mini ikke serverer direkte fra GitHub. GitHub brukes bare til å trigge workflowen og levere repo-innholdet til runner-jobben.
- Backend kjører fortsatt som egen LaunchAgent-prosess på Mac mini. Workflowen deployer kode og restart, men runtime `.env`, `data/`, `logs/`, `storage/`, migreringer, backfills og produksjonsdata håndteres separat.

## Arbeidskopier lokalt
- Mappen over repoet inneholder nå to vanlige git-kloner: `prod/` og `test/`.
- `prod/` skal holdes tett på `origin/main`.
- `test/` brukes til ny branch og pågående arbeid før PR/merge.

## Agentflate
- Codex-worktrees er standard lokal agentflate for parallelt arbeid og diff-review.
- `GitHub Issues` er backlog, prioriteringsflate og statusflate.
- `GitHub Pull Requests` er review-, merge- og leveranseflate.
- `GitHub Milestones` styrer rekkefølge og prioritet.
- Labels skal beskrive type, område eller avklaring, ikke prioritet.
- `Linear` skal ikke brukes som standard arbeidsflate for nye oppgaver i dette repoet.

## Konvensjoner
- Behold norsk språk i brukergrensesnittet.
- Bruk tydelige norske navn i filer/komponenter der det gir mening, men tekniske konstanter kan være engelske.
- Skriv små komponenter med én hensikt per område.
- Oppdater `docs/status/` når en større visuell eller funksjonell endring går live.
