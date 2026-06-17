# Cline Kanban-oppsett for Flyvendebonder

Dette dokumentet beskriver standardoppsettet for `Cline Kanban` i Flyvendebonder.

## Status
- `cline` er installert globalt med `npm install -g cline`
- Standard provider i Cline er satt til `openai-codex`
- Repoet har eget oppstartsskript for Kanban
- GitHub Issues og GitHub Milestones er standard arbeidsflate for nye oppgaver

## Verifiser lokalt
Kjor disse kommandoene for a bekrefte oppsettet:

```bash
cline --version
./scripts/run-cline-kanban.sh
```

## Auth
Forste gangs oppsett eller reauth:

```bash
cline auth
```

Velg:
- `Sign in with ChatGPT Subscription` hvis du vil bruke ChatGPT/Codex-abonnementet
- `Import from Codex CLI` bare hvis importen faktisk virker lokalt
- `Use your own API key` hvis du senere vil bytte provider

Flyvendebonder er satt opp med `openai-codex` som standard lokalt.

## Historisk Linear MCP
Linear MCP kan finnes i lokal Cline-konfig fra tidligere oppsett, men skal ikke brukes som standard arbeidsflate for Flyvendebonder. Behold eller bruk den bare dersom Henry eksplisitt ber om historisk oppslag eller migrering.

Eksempel på tidligere konfig:

```json
{
  "mcpServers": {
    "linear": {
      "url": "https://mcp.linear.app/mcp",
      "type": "streamableHttp"
    }
  }
}
```

Ved forste bruk i Cline kan `Linear` be om egen auth, men dette er ikke nødvendig for dagens GitHub-first flyt.

## Start Kanban i repoet
Fra repo-roten:

```bash
./scripts/run-cline-kanban.sh
```

Alternativt:

```bash
cline --kanban
```

Kanban skal alltid startes fra repo-roten, slik at worktrees opprettes mot riktig git-arbeidstre.

## Praktisk bruk i Flyvendebonder
1. Triager saken i `GitHub Issues`
2. Start Kanban
3. Opprett eller generer kort
4. Kjor agent per kort i egen worktree
5. Review diff i Kanban
6. Kjor validering
7. Commit eller aapne PR
8. Oppdater GitHub issue med status, PR-lenke, validering og neste steg

## Grenser
- `Kanban` erstatter ikke GitHub PR-review
- `Kanban` erstatter ikke deploy-flyten
- `GitHub Issues` og `GitHub Milestones` er backlog, statusflate og prioriteringsrekkefølge
- `Linear` skal ikke brukes som standard arbeidsflate for nye Flyvendebønder-oppgaver
