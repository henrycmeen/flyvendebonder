# Cline Kanban, GitHub og Linear i Flyvendebønder

Dette dokumentet beskriver den praktiske arbeidsflyten for Flyvendebønder med `Linear` som planflate og `Cline Kanban` som lokal agentflate.

## Mål
- Holde `Linear` som backlog, prioritering og prosjektstatus.
- Holde `Cline Kanban` som arbeidsflate for worktrees, agentkort og diff-review.
- Holde `GitHub` som kode- og PR-system.
- La alle PR-er få samme validering lokalt og i GitHub.

## Det som er satt opp
- `cline` er installert globalt på maskinen.
- `Cline` er satt til `openai-codex` som standard provider lokalt.
- `Linear` MCP-server er lagt inn i Cline som remote server på `https://mcp.linear.app/mcp`.
- Oppstartsskript finnes i `scripts/run-cline-kanban.sh`.
- Repoet har `.clineignore` for å skjerme store eller irrelevante mapper fra agentkontekst.
- PR-validering i `.github/workflows/pull-request-validate.yml`
- Standard lokal validering i `scripts/validate-agent-worktree.sh`
- Ikke-interaktiv stack-smoke i `scripts/run-stack-smoke.sh`
- GitHub issue- og PR-maler under `.github/`
- GitHub label-sync i `scripts/sync-github-labels.sh`
- Enkel listevisning for agentklare issues i `scripts/list-agent-ready-issues.sh`

## Operativ hovedflyt
1. Triager saken i `Linear`.
2. Del saken i konkrete arbeidsbiter hvis den er for stor.
3. Start Kanban fra repo-roten:
   - `./scripts/run-cline-kanban.sh`
4. Opprett ett Kanban-kort per konkret kodeoppgave.
5. La agenten jobbe i egen worktree fra Kanban.
6. Review diff i Kanban før commit eller PR.
7. Kjor lokal validering ved behov eller som egen agentoppgave:
   - `./scripts/validate-agent-worktree.sh`
   - `./scripts/run-stack-smoke.sh`
8. Aapne eller oppdater PR i GitHub.
9. Oppdater `Linear` manuelt med status og lenke til PR.

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
- `Linear`: prioritering, scope, status og prosjektoversikt.
- `Cline Kanban`: kjore agentoppgaver i worktrees, følge progresjon og reviewe diff.
- `GitHub`: endelig PR, checks og merge.
- Ikke prøv å speile alt perfekt mellom `Linear`, Kanban og GitHub. `Linear` kan gjerne eie epics og intern oppdeling, mens GitHub bare fanger det som faktisk blir kodeendringer og PR-er.

## Linear i Cline
- `Linear`-serveren er lagt inn i Cline via MCP.
- Auth mot `Linear` skjer i Cline ved forste faktiske bruk av serveren.
- Bruk `Linear` som kontekst og oppslag for saker, ikke som rigid state-maskin for agentkort.
- Kanban-kort kan opprettes manuelt ut fra `Linear`, eller du kan be sidebaren i Kanban om a bryte ned en sak til flere kort.

## Kanban-regler for dette repoet
- Ett kort per konkret kodeendring eller reviewbar valideringsjobb.
- Hold kortene sma nok til at diffen er lett a reviewe.
- Bruk manuell commit/PR som standard inntil flyten er stabil over tid.
- Ikke la Kanban drive deploy direkte; deploy gar fortsatt via vanlig PR til `main` og eksisterende GitHub Actions-flyt.

## Labels
Anbefalte labels synkes med:

```bash
./scripts/sync-github-labels.sh
```

Agentklare GitHub-saker kan listes med:

```bash
./scripts/list-agent-ready-issues.sh
```
