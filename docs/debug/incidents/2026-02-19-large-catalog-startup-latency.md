---
slug: large-catalog-startup-latency
reported_by: bruker
---

# Incident: Treg oppstart og tom kartflate ved stor bildekatalog

## Scenario
1. Åpne `/app/` med stor kumulativ katalog (flere hundre bilder).
2. Appen gjør ett stort `GET /api/v1/photos?mode=cumulative`.
3. UI bruker lang tid før markører vises, og i enkelte tilfeller står kartet tomt etter timeout/abort.

## Forventet
Kartvisning skal vise bilder raskt og stabilt, også når katalogen er stor.

## Faktisk
- Første last kunne bli treg.
- Bruker opplevde tom kartflate selv om API svarte med data.

## Sporingsinfo
- API svarte på `timeline` og `photos`, men frontend ventet på stor samlet payload.
- Markørlag gjorde tungt arbeid ved oppstart (popup-DOM for alle markører + iterasjoner over hele datasettet).

## Sannsynlig rotårsak
- For mye arbeid i én oppstartsrunde: stor payload + tung markørinitialisering.
- Manglende progressiv lastestrategi for kartflyten.

## Implementert fix
- Kartflyt bruker paginert lasting via `GET /api/v1/photos/page`.
- Progressiv oppdatering av `photoPool` per side + fallback til `/photos`.
- MarkerCluster settes med `chunkedLoading`.
- Popup-innhold bygges lazy ved åpning i stedet for for alle markører ved init.
- Ikonoppdatering bruker `Map`-lookup i stedet for gjentatt lineært søk.

## Verifisering
- `npm run lint` grønt.
- `npm run build` grønt.
- Lokal API-verifisering viser rask sidevis lasting av bilder.
