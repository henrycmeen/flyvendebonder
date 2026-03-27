# Videojobb-kontrakt v1

Denne notaten beskriver første backend-kontrakt for videoflyten i Flyvendebønder.

## Mål

Gi frontend en stabil API-overflate for:
- opplasting av video
- polling av jobbstatus
- enkel review-lagring
- visning av artefakter på kart

Dette er fortsatt bevisst **ikke** full videoprosessering. Nå leverer backenden en deterministisk frames-/rutekontrakt fra jobbconfig, slik at frontend og reviewflyt kan bygges mot stabile data mens vi avklarer faktisk motor for frame-uttrekk, telemetri og fotogrammetri.

## Endepunkter

- `POST /api/v1/video-jobs`
  - `multipart/form-data`
  - felter: `file`, `mode`, `config`
  - returnerer `job.job_id`, status, config og `result_frames`
- `GET /api/v1/video-jobs`
  - returnerer siste jobber for aktiv bruker
  - støtter enkel filtrering med `limit`, `mode` og `status`
- `GET /api/v1/video-jobs/{job_id}`
  - returnerer samme jobbsammendrag som frontend kan polle
  - inkluderer også eksplisitt `result_map3d`/route-artefakter med ferdige URL-er
- `PUT /api/v1/video-jobs/{job_id}/review`
  - lagrer `review_state` og eventuell `placement`
- `GET /api/v1/video-jobs/{job_id}/preview.jpg`
- `GET /api/v1/video-jobs/{job_id}/geodata.geojson`
- `GET /api/v1/video-jobs/{job_id}/metadata.json`

## Kontrakt nå

- `frames`-modus er støttet i praksis.
- Jobben fullføres umiddelbart med et deterministisk resultat basert på `fps`, `duration_seconds`, `interval_seconds` og eventuelle `route_points` i config.
- Artefakter lagres under `APP_DATA_ROOT/video-jobs/{job_id}/`.
- Jobbstatus og review lagres i databasen (`video_jobs`, `video_job_reviews`).
- Jobbpayloaden eksponerer både `result_frames` og `result_map3d`, slik at klienten slipper å derivere artefakt-URL-er selv.
- `geodata.geojson` inneholder både rute (`LineString`) og valgte steg (`Point`-features).
- `metadata.json` speiler den beregnede frames-kontrakten, slik at backend og filer forteller samme historie.

## Hvorfor denne formen

- Frontenden var allerede bygget rundt `/api/v1/video-jobs`, men repo-backenden manglet hele kontrakten.
- Vi trengte en ekte backend-overflate før vi bandt oss til `ffmpeg`, `OpenCV`, `WebODM` eller egen pipeline.
- Denne varianten gjør det mulig å stabilisere UI og brukerflyt først, og så bytte ut motoren bak senere uten å endre kontrakten like mye.
- Ved å flytte state til databasen kan vi nå bygge videre med historikk, retry og kobling mot andre domener uten å miste jobber ved restart.

## Neste steg

- koble metadata mot ekte video/telemetri i stedet for config-drevet rute
- la frame-uttrekk produsere egne thumbnails i stedet for å gjenbruke én preview
- koble videre mot processing-sporet for ODM/WebODM der det gir mening
