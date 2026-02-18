# FVB-016 – Overlapp- og footprint-kvalitet: planlagt vs faktisk

## Målet
Gjøre footpring/overlapp til et operativt QC-signal i stedet for bare displayfelt.

## Område
Metadata/QC og geometri (FVB-006/010).

## Status
Pågang (inspirasjon/forretning).

## Inspirasjon
- [mikoontz/neon-drone-workflow overlap script](https://raw.githubusercontent.com/mikoontz/neon-drone-workflow/master/workflow/02_preprocess-drone-data/03_drone_L0_image-overlap-calculator.R): planned vs actual overlap, rotert footprint.
- [luipir/image_footprint_code_recompilation](https://raw.githubusercontent.com/luipir/image_footprint_code_recompilation/master/camera_calculator.py): ray-basert fotavtryk og hjørnepunkter.
- [spifftek70/Drone-Footprints](https://github.com/spifftek70/Drone-Footprints) (AGPL-3.0): end-to-end footprint-liste og GeoJSON-output.

## Oppdaget i koden vår i dag
- `apps/backend-api/app/services/metadata_utils.py` beregner nå:
  - `gsd_m`
  - `image_footprint_w_m = gsd * img_width`
  - `track_spacing_m` fra antatt sidelap
  - men det mangler punktformet footprint-robusthet utover enkel center+radius i CLI.
- `apps/backend-api/app/services/analysis_enrich.py` gir usikkerhet og sample-zone, men overlapplogikken er fortsatt et antagelsesfelt.
- UI viser footprint polygon i `map-canvas`/`photo-map-inset`, så et ekstra kvalitetssignal kan kobles rett inn.

## Forslag (inspirasjonsdrevet)
- Utvid analysepipeline med et dedikert footprint-pass:
  1. Lag `footprint_polygon` som faktisk roteres med heading (ikke bare sirkel/ramme rundt center).
  2. Beregn `overlap_actual_front/side` i postprosess basert på sekvens (nabolagsnøkler og avstand).
  3. Registrer `coverage_profile` per serie: antall bilder, planlagt vs faktisk overlapplogikk, store avvik.
  4. Legg QC-tag hvis avvik eller manglende felter (brukes i eksisterende `showOnlyManualQc`/lav tillit).

## Akseptanse
- `track_spacing_m` er tydelig knyttet til beregnet fotavtrykk og faktisk overlapprosess.
- `coverage_profile` finnes i rapport/API for minst siste N bilder.
- Avvik mellom planlagt og faktisk overlap merkes i `quality_flags` uten å stoppe import.
- UI kan vise en enkel “coverage health” i manuell QC uten nye store UI-kontroller.
