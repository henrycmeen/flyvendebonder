# Flyvendebønder – Backend processing v0

## Mål
Koble dagens fotoingest, felt og flyoppdrag til et eget processing-lag i backend, slik at tunge jobber kan spores og byttes mellom motorer uten at resten av produktet må endres vesentlig.

Dette er første grunnmur for senere bruk av `ODM` eller `WebODM`.

## Hvorfor dette trengs
Flyvendebønder har allerede:

- `Photo` for ingestede bilder
- `FieldPlot` for valgte jorder
- `FlightMission` for planlagte oppdrag og eksport

Det som manglet var mellomlaget mellom disse og tunge prosesseringsmotorer. Uten det ble ortho/raster/point-cloud-sporet bare en løs idé i backlog.

## Ny modell

### `FlightCapture`
Grupperer mange bilder til én prosesserbar enhet.

Brukes til:
- å samle et konkret bildesett fra én flyvning eller dataset
- å knytte bildesettet til aktiv eiendom
- å koble det til et eksisterende `FlightMission` når det finnes

Lagrer blant annet:
- `photo_ids`
- `photo_count`
- `captured_from` / `captured_to`
- `field_ids`
- `mission_id`

### `ProcessingRun`
Representerer én asynkron jobb mot en prosesseringsmotor.

Brukes til:
- å opprette en jobb mot `webodm`, senere `odm` eller andre motorer
- å spore `queued`, `running`, `completed`, `failed`
- å lagre `external_job_id` og input-manifest

### `ProcessingArtifact`
Representerer output fra en processing-run.

Brukes til:
- ortho
- DSM/DTM
- point cloud
- thumbs
- rapporter og andre avledede filer

Lagrer blant annet:
- `kind`
- `format`
- `uri`
- `checksum`
- `metadata`
- `provenance`

V0.1-kontrakten bruker nå et lite, eksplisitt sett artifact-typer og formater:

- typer: `ortho`, `dsm`, `dtm`, `point_cloud`, `thumb`, `tiles`, `mesh`, `qa_report`
- formater: `cog`, `geotiff`, `pmtiles`, `jpg`, `png`, `webp`, `laz`, `las`, `obj`, `json`, `pdf`

Dette er bevisst smalt for å holde artifacts kompatible med senere STAC-/raster-spor uten at backend må kjenne hele katalogmodellen allerede nå.

## Første API

### Flight captures
- `POST /api/v1/flight-captures`
- `GET /api/v1/flight-captures`
- `GET /api/v1/flight-captures/{id}`

### Processing runs
- `POST /api/v1/processing-runs`
- `GET /api/v1/processing-runs`
- `GET /api/v1/processing-runs/{id}`
- `PATCH /api/v1/processing-runs/{id}`

### Artifacts
- `POST /api/v1/processing-runs/{id}/artifacts`
- `GET /api/v1/processing-runs/{id}/artifacts`

## Produktkobling
Dette gjør produktet mer helhetlig på tre måter:

- Foto er ikke lenger bare enkeltbilder; de kan samles til en faktisk flyvning.
- Flyoppdrag er ikke lenger bare eksport; de kan kobles til senere prosessering.
- Raster- og ortho-sporet får en tydelig backend-kontrakt som passer med `HEN-55`, `HEN-58` og senere STAC/PMTiles.

## Bevisste ikke-mål i v0
- ingen direkte WebODM-integrasjon ennå
- ingen bakgrunnsworker ennå
- ingen automatisk polling mot eksterne jobber ennå
- ingen frontend for processing-sporet ennå

## Naturlige neste steg
1. La `HEN-72` avklare om første motor skal være `WebODM API` eller `ODM CLI`.
2. La `HEN-73` forbedre hvordan bilder grupperes til captures.
3. La `HEN-74` innføre faktisk adapter/polling mot valgt motor.
4. La `HEN-75` koble artifacts videre til STAC og rasterlevering.
