# STAC-kontrakt v1

`HEN-55` etablerer første STAC-spor i Flyvendebønder uten å gjøre STAC til generell katalogmotor eller erstatning for GeoJSON.

## V1-beslutning

- `Collection` representerer én `FlightCapture`
- `Item` representerer én `ProcessingRun`
- bare runs med `ortho`-asset eksponeres som STAC-items
- `ortho` er påkrevd asset i v1
- `tiles` og `thumb` er valgfrie assets når de finnes
- `metadata` eksponeres alltid som intern lenke til `GET /api/v1/processing-runs/{id}`

Dette gjør kontrakten konkret nok til å katalogisere første ortholeveranser, men holder oss unna full STAC API, søk, paging og egendefinerte extensions.

## Endepunkter

- `GET /api/v1/stac/collections`
- `GET /api/v1/stac/collections/{collection_id}`
- `GET /api/v1/stac/collections/{collection_id}/items`
- `GET /api/v1/stac/collections/{collection_id}/items/{item_id}`

ID-strategi i v1:

- `collection_id = capture-{capture_id}`
- `item_id = processing-run-{run_id}`

## Asset-kontrakt

Faste assetnøkler i v1:

- `ortho`
- `tiles`
- `thumb`
- `metadata`

Vi eksponerer ikke `dsm`, `dtm`, `point_cloud` eller andre artefaktklasser i STAC v1 ennå. De blir liggende i interne API-er til vi vet hvilken STAC-profil som faktisk gir mening for dem.

## Metadata og checksums

- `geometry`, `bbox`, `proj:code`, `proj:shape`, `proj:transform` og `bands` leses fra `ProcessingArtifact.metadata` på `ortho`
- hvis artifactet mangler geometri, faller vi tilbake til capture-felt eller fotoboks
- checksums og annen detaljert provenance ligger fortsatt i interne processing-endepunkter og nås via `metadata`-assetet

Det betyr at STAC-payloaden holdes ren og standardnær, mens interne detaljer fortsatt kan spores uten å innføre egne STAC-extensions nå.

## Forholdet til GeoJSON

- GeoJSON brukes fortsatt for felt, polygoner, ruter og annen vektorgeometri
- STAC brukes for raster- og flight-nære leveranser

De to kontraktene er komplementære, ikke konkurrerende.

## Rio-STAC-vurdering

`rio-stac` er fortsatt interessant, men ikke nødvendig for denne første kontrakten.

Begrunnelse:

- vi har ennå ikke en faktisk COG/GeoTIFF-løype som genererer full rastermetadata automatisk i backend
- v1 trenger først og fremst stabil ID-strategi, asset-navn og kobling til eksisterende processing-domene
- når ekte orthofiler og GDAL/rastermetrikker er på plass, kan `rio-stac` brukes som generator eller valideringssteg for `ortho`-assetet

Praktisk beslutning i v1:

- ja til STAC-kontrakt nå
- nei til å gjøre `rio-stac` til hard avhengighet før vi har reelle rasterfiler i løypa
