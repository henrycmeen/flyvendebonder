# Agentarbeid i Flyvendebønder

Dette dokumentet beskriver hvordan repoet brukes som pilot for agentassistert utvikling før eventuell Symphony-vurdering.

## Mål
- Gjøre små GitHub-issues om til reviewbare PR-er.
- La agenter validere mest mulig selv før menneskelig review.
- Holde live deploy og drift under manuell kontroll til pilotfasen er stabil.

## Det som er satt opp i repoet
- PR-validering i `.github/workflows/pull-request-validate.yml`
- Standard lokal validering i `scripts/validate-agent-worktree.sh`
- Ikke-interaktiv stack-smoke i `scripts/run-stack-smoke.sh`
- Agentregler i `WORKFLOW.md`
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
Disse settes i GitHub UI ved behov. De er ikke en del av repoet.

1. Bruk pull request som standard vei til `main`.
2. Følg med på grønne checks før merge:
   - `validate`
   - `stack-smoke`
3. Hold auto-merge av i pilotfasen.
4. Slå på branch protection senere hvis repoet blir offentlig eller flyten blir mer kritisk.

## Labels
Anbefalte labels synkes med:

```bash
./scripts/sync-github-labels.sh
```

Agentklare saker kan listes med:

```bash
./scripts/list-agent-ready-issues.sh
```

## Arbeidsmåte i pilotfasen
- Start med små issues som kan løses i én PR.
- Bruk issue-malen `Agentklar oppgave`.
- Be agenten følge `WORKFLOW.md`.
- Hold deploy til `main` manuell via vanlig review og merge.
- Opprett oppfølgingsissues når agenten finner sidearbeid. Ikke utvid PR-en ukontrollert.

## Hva som fortsatt ikke er automatisert
- Backend deploy og restart på Mac mini
- Valgfri GitHub branch protection
- Linear/Symphony-orkestrering

Det er bevisst. Repoet skal først tåle agentiske PR-løp trygt via GitHub Issues.
