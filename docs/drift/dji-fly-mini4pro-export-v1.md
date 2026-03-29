# DJI Fly Mini 4 Pro-eksport v1

## Formål
Flyvendebønder kan nå eksportere `DJI Mini 4 Pro`-oppdrag som `KMZ` tilpasset `DJI Fly`. Dette er et eget spor ved siden av enterprise-eksporten i `dji-wpml-export-v1.md`, fordi `Mini 4 Pro` bruker `DJI Fly` og ikke `DJI Pilot 2`.

## Formater
- `auto`
  - prøver først enterprise `dji-wpml`
  - prøver deretter `dji-fly` for støttede forbrukerprofiler
  - faller til slutt tilbake til generell bundle
- `dji-fly`
  - krever støttet `DJI Fly`-profil
  - returnerer `400` hvis profilen ikke støttes

## Støttet profil i v1
- `dji-mini-4-pro`

## Innhold i eksporten
`DJI Fly`-eksporten bygger en `KMZ` med:
- `wpmz/template.kml`
- `wpmz/waylines.wpml`
- `*.readme.txt`

Denne varianten er tilpasset `DJI Fly`-workflowen:
- `droneEnumValue=68`
- ingen `payloadInfo`
- ingen waypoint-baserte `takePhoto`-actions i v1
- `distance` og `duration` skrives inn på wayline-nivå
- `exitOnRCLost=executeLostAction`
- `executeRCLostAction=goBack`

## Praktisk workflow
I første versjon er målet at filen skal kunne brukes via `DJI Fly` sin lokale waypoint-lagring:
1. Opprett en midlertidig waypoint-rute i `DJI Fly`.
2. Finn den lagrede mission-filen på kontrolleren/enheten.
3. Gi Flyvendebønder-filen samme navn som den midlertidige mission-filen og erstatt den.
4. Åpne missionen i `DJI Fly` og kontroller waypointene før flyging.

## Begrensninger i v1
- Vi har strukturelle tester for `KMZ/WPML`, men ikke endelig smoke-testet import i `DJI Fly` på faktisk `Mini 4 Pro`.
- `takePhoto`-handlinger er ikke lagt inn per waypoint i denne versjonen.
- Kartleggingsopptak må derfor normalt startes med app-/kameraoppsett i `DJI Fly`.
- Workflowen bygger på faktisk observerte `DJI Fly`-mønstre og tredjeparts referanseimplementasjoner, ikke en like tydelig offentlig importspec som enterprise-WPML.

## Neste steg
- smoke-test på faktisk `Mini 4 Pro` og kontroller
- verifiser om `DJI Fly` godtar hele `KMZ`-en uten ekstra manuelle endringer
- test om trygg fotosekvens kan uttrykkes uten å bryte `DJI Fly`-kompatibiliteten
- vurder eksplisitt eksportvalg i frontend: `DJI Fly (Mini 4 Pro)` vs `DJI Enterprise`

## Kilder
- DJI Mini 4 Pro FAQ
- DJI Mini 4 Pro support
- Dronelink: Onboard DJI Waypoint Missions - Convert and Export to KMZ
- Dronelink: Mini 4 Pro Support Overview
