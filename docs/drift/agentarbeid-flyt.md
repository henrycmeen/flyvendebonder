# Codex-worktrees og GitHub i Flyvendebønder

Dette dokumentet beskriver den praktiske arbeidsflyten for Flyvendebønder med
`GitHub Issues` og `GitHub Milestones` som planflate og isolerte Codex-worktrees
som lokal agentflate.

## Mål
- Holde `GitHub Issues` som backlog og statusflate.
- Holde `GitHub Milestones` som prioriteringsrekkefølge.
- Holde hver parallelle Codex-oppgave i en egen worktree med tydelig fileierskap.
- Holde `GitHub` som kode- og PR-system.
- La alle PR-er få samme validering lokalt og i GitHub.

## Det som er satt opp
- Codex-automatiseringer oppretter isolerte worktrees.
- Repoets `AGENTS.md` beskriver GitHub-first-kontrakten.
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
4. Sjekk aktive Codex-tråder og worktrees før nytt arbeid starter.
5. Gi hver oppgave en egen branch og worktree fra oppdatert `origin/main`.
6. Avtal repo-, branch- og fileierskap når flere tråder arbeider parallelt.
7. Review diff og kjør lokal validering før commit eller PR.
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
- `Codex worktrees`: isolert implementering, validering og diff-review.
- `GitHub`: endelig PR, checks og merge.
- Ikke prøv å speile alt mellom gamle Linear-/Kanban-flater og GitHub. GitHub er sannhetskilden for nye oppgaver i dette repoet.

## Historisk Linear-oppsett
- Linear kan finnes i eldre dokumentasjon eller lokal MCP-konfig, men skal ikke brukes som standard arbeidsflate for Flyvendebønder.
- Nye oppgaver, prioritering og status skal ligge i GitHub Issues og GitHub Milestones.
- Bruk bare Linear dersom Henry eksplisitt ber om det for historisk oppslag eller migrering.

## Regler for parallelt Codex-arbeid
- Én konkret kodeendring eller reviewbar valideringsjobb per branch.
- Hold diffene små nok til at de er lette å reviewe og rulle tilbake.
- Bruk GitHub issue og milestone som referanse for arbeidet.
- Ikke la en arbeidstråd drive deploy direkte; deploy går via PR til `main` og eksisterende GitHub Actions-flyt.

## Labels
Anbefalte labels synkes med:

```bash
./scripts/sync-github-labels.sh
```

Agentklare GitHub-saker kan listes med:

```bash
./scripts/list-agent-ready-issues.sh
```
