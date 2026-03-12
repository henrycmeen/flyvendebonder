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
- `LINEAR_API_KEY` er tilgjengelig enten i shellen eller i en repo-lokal env-fil

Anbefalt i dette repoet:

```bash
cp .env.example .env.local
```

Og legg inn:

```bash
LINEAR_API_KEY="lin_api_..."
```

`run-symphony-local.sh` leser automatisk disse filene hvis `LINEAR_API_KEY` ikke allerede er eksportert i shellen:

- `.env`
- `.env.local`
- `.env.symphony`
- `.env.symphony.local`

`.env.local` er anbefalt for lokale hemmeligheter siden filen er ignorert i git.

## Start Symphony lokalt

Fra Flyvendebønder-repoet:

```bash
./scripts/run-symphony-local.sh
```

Det skriptet:
1. kloner eller oppdaterer `openai/symphony`
2. bygger Elixir-implementasjonen
3. starter Symphony med dette repoets `WORKFLOW.md`
4. skriver lokale Symphony-logger til `.symphony-log/`
5. kloner som standard samme git-branch som du står på i Flyvendebønder-repoet

Hvis du vil ha dashboard på egen port:

```bash
SYMPHONY_PORT=4060 ./scripts/run-symphony-local.sh
```

Anbefalt ved feilsøking:

```bash
SYMPHONY_PORT=4060 ./scripts/run-symphony-local.sh --i-understand-that-this-will-be-running-without-the-usual-guardrails
```

Da kan du følge dashboard/API lokalt samtidig:

- `http://127.0.0.1:4060/`
- `http://127.0.0.1:4060/api/v1/state`
- `http://127.0.0.1:4060/api/v1/HEN-6`

## Anbefalt første pilot

Hold aktiv kø liten i starten.

Første saker i `Todo`:

- `HEN-5` `[GH #63] Album: forenkle filter til søkefelt med fritekst for år og sesong`
- `HEN-6` `[GH #59] Standardiser lukkeknapper og sticky header i dialoger/paneler`

Anbefalt driftsregel i første fase:

- bare saker i `Todo` skal plukkes aktivt
- behold `max_concurrent_agents: 1`
- behold `max_turns` lavt i pilot, slik at dårlige løp stopper tidligere
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

## Feilsøking fra pilot 12. mars 2026

- Utløpt Codex-auth ga først `401 Unauthorized` og tomme turns.
- Etter ny innlogging startet worker normalt, men HEN-6 brukte svært mange tokens før første kodeendring.
- Viktigste læring så langt: piloten må styres strammere enn standard Symphony-oppsett. Repoets `WORKFLOW.md` er derfor strammet inn for å redusere bred git-analyse, unødvendig repo-scanning og bare tillate én kontrollert explorer-subagent på feature-saker.
- Senere pilotkjøring viste også at workspaces må opprettes fra faktisk test-branch, ikke bare GitHub `main`, ellers mangler repo-lokale Symphony-filer i worker-klonen.
