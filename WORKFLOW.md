# WORKFLOW.md

Dette repoet er gjort klart for agentassistert arbeid via GitHub Issues og små PR-er.

## Arbeidsregler
- Én issue per PR. Ikke samle flere mål i samme endring.
- Hold endringer reviewbare. Hvis oppgaven vokser, stopp og opprett en oppfølgingssak.
- Merge og live deploy gjøres av menneske i denne pilotfasen. Agenten skal ikke merge eller deploye til produksjon.
- Bruk norsk i brukerrettet tekst, issue-notater og PR-beskrivelser.
- Rør ikke `apps/demo-fotokart/`, deploy-skriptene eller Mac mini-drift uten at issue eksplisitt ber om det.

## Påkrevd validering
- Backend-endringer: `cd apps/backend-api && python3 -m pytest -q`
- Frontend-endringer: `cd apps/web-app && npm run lint && npm run build`
- Endringer som treffer frontend, routing eller API-overflate: `./scripts/run-stack-smoke.sh`
- Standardløype for agent og PR: `./scripts/validate-agent-worktree.sh`

## Pilotområder som er trygge først
- `apps/web-app/`
- `apps/backend-api/app/`
- `apps/backend-api/tests/`
- `docs/`

## Områder som fortsatt krever ekstra varsomhet
- `scripts/deploy-flyvendebonder.sh`
- `.github/workflows/deploy-main.yml`
- backend-restart og annen live-drift på Mac mini
- endringer som krever nye hemmeligheter eller eksterne tjenester

## Når du finner sideproblemer
- Ikke utvid gjeldende PR ukontrollert.
- Dokumenter funnet i PR-en og opprett en ny issue hvis verktøyene du kjører med støtter det.
- Hvis ikke, legg igjen en konkret TODO med akseptansekriterier i PR-notatene.
