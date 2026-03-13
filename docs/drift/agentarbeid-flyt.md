# GitHub og Linear i Flyvendebønder

Dette dokumentet beskriver den praktiske arbeidsflyten for Flyvendebønder uten Symphony.

## Mål
- Holde Linear som arbeidsflate for backlog, prioritering og status.
- Holde GitHub som kode- og PR-system.
- La alle PR-er få samme validering lokalt og i GitHub.

## Det som er satt opp i repoet
- PR-validering i `.github/workflows/pull-request-validate.yml`
- Standard lokal validering i `scripts/validate-agent-worktree.sh`
- Ikke-interaktiv stack-smoke i `scripts/run-stack-smoke.sh`
- GitHub issue- og PR-maler under `.github/`
- GitHub label-sync i `scripts/sync-github-labels.sh`
- Enkel listevisning for agentklare issues i `scripts/list-agent-ready-issues.sh`

## Standard valideringsløype
1. Installer avhengigheter:
   - `cd apps/backend-api && python3 -m pip install -r requirements.txt`
   - `cd apps/web-app && npm ci`
2. Kjør standardvalidering:
   - `./scripts/validate-agent-worktree.sh`
3. Kjør stack-smoke når endringen påvirker frontend, API-overflate eller routing:
   - `./scripts/run-stack-smoke.sh`

## Anbefalte GitHub-innstillinger
1. Bruk pull request som standard vei til `main`.
2. Følg med på grønne checks før merge:
   - `validate`
   - `stack-smoke`
3. Hold auto-merge av til flyten er stabil.

## Praktisk rollefordeling
- Opprett eller triager arbeid i Linear først når saken krever prioritering, splitting eller prosjektoversikt.
- Behold GitHub-issues for repo-nære leveranser som skal ende i PR.
- Ikke prøv å tvinge perfekt én-til-én-speiling av alle interne Linear-saker til GitHub; epics og interne oppdelinger kan godt bo bare i Linear.

## Labels
Anbefalte labels synkes med:

```bash
./scripts/sync-github-labels.sh
```

Agentklare GitHub-saker kan listes med:

```bash
./scripts/list-agent-ready-issues.sh
```
