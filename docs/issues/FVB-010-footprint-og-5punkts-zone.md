# FVB-010 – Footprint og 5-punkts sone

## Målet
Forsterke geometrilaget før AI med en konsistent analyse-sone per bilde.

## Område
Geometri / analyseforberedelse.

## Gjeldende status
Operativt i gang (grundlag for punkt-sampling og footprint er på plass).

## Gjennomført nå
- `analysis_zone` returneres i `PhotoFeature` med:
  - `center_point`
  - `sample_points` (cross_5)
  - `footprint_polygon` (GeoJSON)
  - `sampling_strategy` (type + radius)
  - `analysis_area_m`
- Kart og fullskjerm visualiserer nå footprint, target-område og 5 samplepunkter.
- UI viser nå soneinformasjon i metadatafeltet (type/radius/punkter).

## Leveranse
- Definer en tydelig `analysis_zone` i foto-API:
  - `center_point`
  - `sample_points` (cross_5)
  - `footprint_polygon` (GeoJSON Polygon)
  - `sampling_strategy` (`cross_5`, `radius_m`)
  - `uncertainty_radius_m`, `analysis_area_m`
- Bruk samme punktmønster i analyse + UI-visualisering.
- Gjør størrelsen på sone konfigurerbar i enkle innstillinger (serie-nivå).
- Dokumentér hvordan `analysis_zone` brukes i QC og jordtype/AR5-spørring.

## Akseptanse
- `/api/v1/photos` svarer med `analysis_zone` i `PhotoFeature`.
- `analysis_zone.sample_points` inneholder 5 punkter.
- `analysis_zone.center_point` samsvarer med beregnet synspunkt (eller kildepunkt når estimat mangler).
- `footprint_polygon` er gyldig GeoJSON polygon med lukkede koordinater.
- `sample_points` og footprint-omriss følger samme rotasjon som heading.
- Enklere UI-kontroll for sampling-strategi (`cross_5`) kan settes i backend nå.
- Usikkerhet (`uncertainty_radius_m`) øker radius i kontrollerte steg (ikke tilfeldig).
- Kart-UI og bildeinnsikt viser nå footprint + analyseteknisk punktmønster.

## Neste arbeid
1. Gjør `sampling_strategy.radius_m` styrbart per serie (evt. UI/konfig) uten å endre datamodellen.
2. Legg inn eksplisitt fallback-status om pitch/heading mangler, men behold deterministisk oppførsel.
