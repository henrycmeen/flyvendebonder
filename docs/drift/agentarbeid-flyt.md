# Cline Kanban og GitHub i Flyvendebønder

Dette dokumentet beskriver den praktiske arbeidsflyten for Flyvendebønder med `GitHub Issues` og `GitHub Milestones` som planflate og `Cline Kanban` som lokal agentflate.

## Mål
- Holde `GitHub Issues` som backlog og statusflate.
- Holde `GitHub Milestones` som prioriteringsrekkefølge.
- Holde `Cline Kanban` som arbeidsflate for worktrees, agentkort og diff-review.
- Holde `GitHub` som kode- og PR-system.
- La alle PR-er få samme validering lokalt og i GitHub.

## Det som er satt opp
- `cline` er installert globalt på maskinen.
- `Cline` er satt til `openai-codex` som standard provider lokalt.
- Oppstartsskript finnes i `scripts/run-cline-kanban.sh`.
- Repoet har `.clineignore` for å skjerme store eller irrelevante mapper fra agentkontekst.
- PR-validering i `.github/workflows/pull-request-validate.yml`
- Standard lokal validering i `scripts/validate-agent-worktree.sh`
- Ikke-interaktiv stack-smoke i `scripts/run-stack-smoke.sh`
- GitHub issue- og PR-maler under `.github/`
- GitHub label-sync i `scripts/sync-github-labels.sh`
- Enkel listevisning for agentklare issues i `scripts/list-agent-ready-issues.sh`

## Operativ hovedflyt
1. Triager saken i `GitHub Issues`.
2. Del saken i konkrete arbeidsbiter hvis den er for stor.
3. Bruk GitHub milestone som prioriteringsrekkefølge, ikke egne prioritet-labels.
4. Start Kanban fra repo-roten:
   - `./scripts/run-cline-kanban.sh`
5. Opprett ett Kanban-kort per konkret kodeoppgave.
6. La agenten jobbe i egen worktree fra Kanban.
7. Review diff i Kanban før commit eller PR.
8. Kjor lokal validering ved behov eller som egen agentoppgave:
   - `./scripts/validate-agent-worktree.sh`
   - `./scripts/run-stack-smoke.sh`
9. Aapne eller oppdater PR i GitHub.
10. Oppdater GitHub issue med status, PR-lenke, validering og neste steg.

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
- `GitHub Issues`: backlog, scope, status og prosjektoversikt.
- `GitHub Milestones`: prioriteringsrekkefølge.
- `Cline Kanban`: kjore agentoppgaver i worktrees, følge progresjon og reviewe diff.
- `GitHub`: endelig PR, checks og merge.
- Ikke prøv å speile alt mellom gamle Linear-saker, Kanban og GitHub. GitHub er sannhetskilden for nye oppgaver i dette repoet.

## Historisk Linear-oppsett
- Linear kan finnes i eldre dokumentasjon eller lokal MCP-konfig, men skal ikke brukes som standard arbeidsflate for Flyvendebønder.
- Nye oppgaver, prioritering og status skal ligge i GitHub Issues og GitHub Milestones.
- Bruk bare Linear dersom Henry eksplisitt ber om det for historisk oppslag eller migrering.

## Kanban-regler for dette repoet
- Ett kort per konkret kodeendring eller reviewbar valideringsjobb.
- Hold kortene sma nok til at diffen er lett a reviewe.
- Bruk GitHub issue og milestone som referanse for hvert agentkort.
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
