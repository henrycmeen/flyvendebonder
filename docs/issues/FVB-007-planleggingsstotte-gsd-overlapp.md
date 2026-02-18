# FVB-007 – Planleggingsstøtte for GSD og flyruteparametre

## Målet
Gi et lite, operativt planleggingshjul for GSD/overlapp før import, basert på samme felter vi allerede bruker i FVB-006.

## Område
Flyplanlegging og datakvalitetsforberedelse.

## Status
Delvis ferdig i ideplan (mangler implementasjon i script-UI nå).

## Inspirasjon
- [OpenGeoOne/qgis-drone-flight-planner](https://github.com/OpenGeoOne/qgis-drone-flight-planner) (MIT): praktiske beregningsmønstre for front-/sidelap og sporavstand.
- [hotosm/drone-flightplan](https://github.com/hotosm/drone-flightplan) (AGPL-3.0): planleggingsstruktur som kan inspirere CLI-API for oppstart.

## Forslag
- I stedet for full flyplan-engine nå, legg vi et lite `scripts/plan-flight`-verktøy som:
  - tar kamera-innstillinger (`focal_length_mm`, `sensor_width_mm`, bildebredde, bildehøyde, pitch/heading-strategi),
  - beregner mål-GSD + anbefalt høyde,
  - beregner anbefalt `track_spacing_m` fra overlapper,
  - skriver forslag og forutsetninger i JSON/Markdown.
- Bruke samme feltnavn som backend allerede har:
  - `focal_length_mm`
  - `overlap_front` / `overlap_side`
  - `track_spacing_m`
- Koble dette til `docs/drift/` som beslutningsstøtte før nytt innhøstingsløp.

## Akseptanse
- Scriptet produserer én anbefaling for gitt mål-GSD og valgt kameraprofil.
- Output inneholder minst: anbefalt høyde, `track_spacing_m`, forventet fotavtrykk og hvilke formler som er brukt.
- Kjøring mislykkes ikke blindt ved manglende felt; manglende data markeres tydelig som manuell kontroll.

## Neste steg (sannsynlig rekkefølge)
1. Legg til `scripts/plan-flight` med JSON-output.
2. Legg ved `--target-gsd` og `--frontlap`/`--sidelap` i CLI.
3. Dokumenter i `docs/drift/` med et lite eksempel på én flyrute.
