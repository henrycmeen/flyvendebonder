# Symphony-oppsett for Flyvendebønder

Dette dokumentet beskriver hvordan Flyvendebønder kjøres med OpenAI Symphony som langkjørende orkestrator.

## Nåværende status

- Linear-prosjekt: `Flyvendebønder`
- Project slug: `flyvendebonder-caba5c6a47de`
- Repo-workflow: `WORKFLOW.md`
- Lokal bootstrap: `scripts/symphony-bootstrap.sh`
- Lokal startkommando: `scripts/run-symphony-local.sh`

## Hva som allerede er satt opp i repoet

- Symphony-kompatibel `WORKFLOW.md` i repo-roten
- Repo-lokale Codex-skills under `.codex/skills/`
- Lokal bootstrap for backend `.venv` og frontend-avhengigheter
- PR-validering og stack-smoke som kan brukes av agentene

## Manuell Linear-konfig som fortsatt må gjøres

I teamet `Henrymeen` må disse ekstra workflow-statene opprettes i Linear:

- `Human Review`
- `Rework`
- `Merging`

Anbefalt type for alle tre: ikke-terminal arbeidstilstand.

Repoets `WORKFLOW.md` forventer disse statusene. Uten dem vil agenten stoppe når den prøver å håndtere review- og merge-flyt.

## Miljøkrav på maskinen som skal kjøre Symphony

- `codex` er installert og innlogget med din ChatGPT-konto
- `gh` er installert og autentisert mot `henrycmeen/flyvendebonder`
- `mise` er installert
- Git-tilgang til repoet fungerer
- `LINEAR_API_KEY` er satt

Eksempel:

```bash
export LINEAR_API_KEY="lin_api_..."
```

## Start Symphony lokalt

Fra Flyvendebønder-repoet:

```bash
./scripts/run-symphony-local.sh
```

Det skriptet:
1. kloner eller oppdaterer `openai/symphony`
2. bygger Elixir-implementasjonen
3. starter Symphony med dette repoets `WORKFLOW.md`

Hvis du vil ha dashboard på egen port:

```bash
./scripts/run-symphony-local.sh --port 4060
```

## Anbefalt første pilot

Hold aktiv kø liten i starten.

Første saker i `Todo`:

- `HEN-5` `[GH #63] Album: forenkle filter til søkefelt med fritekst for år og sesong`
- `HEN-6` `[GH #59] Standardiser lukkeknapper og sticky header i dialoger/paneler`

Anbefalt driftsregel i første fase:

- bare saker i `Todo` skal plukkes aktivt
- behold `max_concurrent_agents: 1`
- flytt saker til `Rework` manuelt når review ber om endringer
- flytt til `Merging` bare når du faktisk vil at merge-løpet skal kjøres

## Flyt

1. Du flytter en sak til `Todo`.
2. Symphony flytter den til `In Progress`.
3. Agenten jobber i egen workspace, åpner eller oppdaterer PR, og dokumenterer alt i én Linear-kommentar.
4. Når PR er klar og grønn, flyttes saken til `Human Review`.
5. Ved feedback flyttes saken til `Rework`.
6. Når du vil lande PR-en, flyttes saken til `Merging`.
7. Symphony kjører merge-løpet og flytter saken til `Done`.

## Kommentar

OpenAI beskriver fortsatt Symphony Elixir som prototypeprogramvare for evaluering. Dette oppsettet er derfor bevisst konservativt: ett repo, én agent om gangen, og manuell kontroll på review og merge-overganger.
