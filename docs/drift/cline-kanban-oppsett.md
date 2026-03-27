# Cline Kanban-oppsett for Flyvendebonder

Dette dokumentet beskriver standardoppsettet for `Cline Kanban` i Flyvendebonder.

## Status
- `cline` er installert globalt med `npm install -g cline`
- Standard provider i Cline er satt til `openai-codex`
- `Linear` MCP-server er lagt inn i Cline
- Repoet har eget oppstartsskript for Kanban

## Verifiser lokalt
Kjor disse kommandoene for a bekrefte oppsettet:

```bash
cline --version
cline mcp add --type http linear https://mcp.linear.app/mcp
./scripts/run-cline-kanban.sh
```

`cline mcp add` er trygg a kjore flere ganger; den oppdaterer samme servernavn i Cline-konfigen.

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

## Linear MCP
Serveren ligger i Cline sin konfig som:

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

Ved forste bruk i Cline kan `Linear` be om egen auth.

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
1. Triager saken i `Linear`
2. Start Kanban
3. Opprett eller generer kort
4. Kjor agent per kort i egen worktree
5. Review diff i Kanban
6. Kjor validering
7. Commit eller aapne PR
8. Oppdater `Linear` med status og PR-lenke

## Grenser
- `Kanban` erstatter ikke GitHub PR-review
- `Kanban` erstatter ikke deploy-flyten
- `Linear` er backlog og statusflate, ikke eneste sannhetskilde for kode
