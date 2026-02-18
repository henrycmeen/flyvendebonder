# FVB-012 – Open-source CLI pipeline (ingen AI-trening i første omgang)

## Mål
Bruke åpne verktøy for robuste, reproducerbare kvalitetssjekker av geometri og metadata som støtte for kjerneproduktet.

## Område
Datakvalitet, geometri, CLI-arbeidsflyt.

## Status
På vent (sideeksperiment / validering).

## Leveranse (fase 1)
- Egen modulstruktur for CLI-kommandoer:
  - `metadata-qc` (QC-score, heading/pitch status, parsingfeil).
  - `geometry-summary` (view_line, usikkerhet, footprint/samplezone).
  - `orthophoto-poc` (opsjonelt, kun når åpne fotogrammetri-data er tilgjengelig).
- Katalogkonfigurasjon i `scripts/` med enkle manifest-JSON for hver kjøring.
- Felles rapportformat (`json`) som inneholder:
  - `quality_threshold`-vurdering.
  - `manual_review`-kø.
  - `analysis_zone`-felt (`center_point`, `sample_points`, `footprint_polygon`).

## Leveranse (fase 2)
- Legge inn anbefalt CLI-løype fra `docs/innsikt/utvikling/opensourcecliverktøyforlandbruksanalyse.md`:
  - ExifTool for metadata.
  - OpenDroneMap (ved behov for ortofoto/DEM).
  - GDAL for raster- og eksportlogikk.
  - Orfeo ToolBox når multispektrale data finnes.
- Dokumentere ressursbruk og resultatkvalitet per kjøring.

## Akseptanse
- Kjøretid og flagg er loggført i rapporten.
- Rapporten kan brukes direkte i manuell QC.
- Hele kjeden kan kjøres uten å kjøre UI.
- Alt-eller-ingenting unngås: enkelte filfeil bryter ikke hele rapporten.

## Neste steg
1. Gjøre scriptet kjørbart og kjøre et første "småtest" på 3 filer.
2. Feste `manifest.json`-struktur og output-kontrakt i `docs/drift/cli-open-source.md`.
3. Knytte `needs_manual_qc`-flagg og `analysis_zone` til et enkelt UI-filter i web-app når det gir direkte verdi.
4. Definere minimumskrav for å gå videre mot modell- eller vegetasjonsindekser.

## Statusoppdatering
- `scripts/cycle-metadata-qc.sh` er implementert, kjørbart og lagt inn i README/CLI-drift.
- `FVB-011` knyttes videre til et praktisk UI-filter (`showOnlyManualQc`) i kart/album.
- Resultatene brukes kun der de støtter bedre kvalitet i FVB-006/009/010.
