# FVB-009 – Footprint og usikkerhetsmodell

## Målet
Gjøre kamera-geometrien robust før Spor B. Målet er at hvert bilde har sporbart synspunkt og et mål på tillit.

## Område
Geometri, datakvalitet og kartlogikk.

## Status
Operativt grunnlag nå komplett for QC-beslutning (manuell QC + lav tillit-filter er på plass i UI).

## Gjennomført nå
- `heading_source` og `pitch_source` beregnes ved import og returneres på `PhotoFeature`.
- `confidence_score` og `confidence_reasons` beregnes i serialisering.
- `location_uncertainty_m` beregnes med geometri- og kvalitetspålitelighet.
- UI og kart viser nå:
  - punkt mot estimert målpunkt (laser-linje)
  - usikkerhetsring
  - samplepunkter
  - `needs_manual_qc` med visuell markering på pin.
- Fullskjermkortet viser nå usikkerhet, kilder og metadata-score.

## Hva vi leverer
1. Metadata som forklarer hvordan synspunktet er beregnet.
2. Tydelig usikkerhetsmodell per bilde.
3. Konfigurerbar 5-punkts sampling som datamodell, ikke kun UI-funksjon.

## Akseptanse
- `heading_source` og `pitch_source` lagres og vises.
- `confidence_score` (0–1) og `confidence_reasons` kommer på foto-API.
- `location_uncertainty_m` kommer på foto-API.
- UI kan filtrere på høy/lav tillit i en enkel kontroll.
- `analysis_zone`/samplepunkter kan bygges på neste iterasjon uten omstrukturering.
- Kart-UI og fullskjermkort viser nå visuell linje mot `view_lat/lng` + usikkerhetsring.

## Faseinndeling
### Fase 1 (nå)
- Stabiliser metadatafelt i backend (tags + confidence)
- Synliggjør usikkerhet i kart/UI
- Gjennomført for grunnlag 1 (kamera/metadata, usikkerhet, visning, manual QC-edit).

### Fase 2 (kort)
- Legge inn egentlig footprint-polygon (GeoJSON) på bilde
- Legge inn sampling-konfig (`cross_5`, radius, aggregasjonsmetode)

### Fase 3 (videre)
- Bruke zone + usikkerhet i jordtype/spror B-workflows
