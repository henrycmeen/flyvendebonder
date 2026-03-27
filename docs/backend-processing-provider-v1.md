# Flyvendebønder – Processing provider v1

## Anbefaling
Første motor i Flyvendebønder bør være `webodm`, med `odm_cli` som et senere, mer direkte spor.

## Hvorfor `webodm` først
- Vi trenger et jobb-API som passer med `ProcessingRun` og polling i backend.
- `webodm` passer bedre til opprettelse, statuslesing og resultatsporing enn en ren CLI-løype.
- Dette matcher målet vårt om å bruke ODM som intern motor, ikke som sluttbruker-UI i produktet.

## Hvorfor ikke `odm_cli` først
- `odm_cli` gir mer direkte verts- og prosesskontroll, men flytter mer ansvar for jobbstatus, retry, logging og resultatinnhenting inn i vår egen backend med en gang.
- Det er nyttig senere når vi vil ha mer tuning eller kjøre mer spesialiserte løp, men det er unødvendig tidlig kompleksitet i v1.

## Kontrakt i backend
I v1 støtter backend bare disse providerne:
- `webodm`
- `odm_cli`

`webodm` er standardvalg.

Processing-manifestet beskriver også providerprofil:
- `api_mode: poll` for `webodm`
- `api_mode: process` for `odm_cli`

## Forventet første output
Det første praktiske sporet bør fokusere på:
- `ortho`
- `dsm`
- `thumb`
- enkel `qa_report`

Point cloud og mesh er fortsatt relevante, men ikke nødvendig for første produktløp.

## Bevisste ikke-mål
- ingen direkte integrasjon mot WebODM i denne saken
- ingen worker eller scheduler i denne saken
- ingen frontend for valg av provider
- ingen full STAC- eller COG-pipeline i denne saken

## Neste steg
1. Bruk `webodm` som standard når vi tar faktisk motorintegrasjon.
2. La backend poll'e status via `ProcessingRun`.
3. Hent tilbake artifacts og map dem inn i vår artifact-kontrakt.
4. Hold `odm_cli` som en eksplisitt sekundær provider for senere tuning.
