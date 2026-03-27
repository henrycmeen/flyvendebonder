# Videojobb-kontrakt v1

Denne notaten beskriver første backend-kontrakt for videoflyten i Flyvendebønder.

## Mål

Gi frontend en stabil API-overflate for:
- opplasting av video
- polling av jobbstatus
- enkel review-lagring
- visning av artefakter på kart

Dette er bevisst **ikke** full videoprosessering. Første versjon leverer placeholder-data som lar produktflyten fungere mens vi avklarer faktisk motor for frame-uttrekk, telemetri og fotogrammetri.

## Endepunkter

- `POST /api/v1/video-jobs`
  - `multipart/form-data`
  - felter: `file`, `mode`, `config`
  - returnerer `job.job_id`, status, config og `result_frames`
- `GET /api/v1/video-jobs/{job_id}`
  - returnerer samme jobbsammendrag som frontend kan polle
- `PUT /api/v1/video-jobs/{job_id}/review`
  - lagrer `review_state` og eventuell `placement`
- `GET /api/v1/video-jobs/{job_id}/preview.jpg`
- `GET /api/v1/video-jobs/{job_id}/geodata.geojson`
- `GET /api/v1/video-jobs/{job_id}/metadata.json`

## Kontrakt nå

- `frames`-modus er støttet i praksis.
- Jobben fullføres umiddelbart med et lite placeholder-resultat.
- Artefakter lagres under `APP_DATA_ROOT/video-jobs/{job_id}/`.
- Review lagres i et prosesslokalt register.

## Hvorfor denne formen

- Frontenden var allerede bygget rundt `/api/v1/video-jobs`, men repo-backenden manglet hele kontrakten.
- Vi trengte en ekte backend-overflate før vi bandt oss til `ffmpeg`, `OpenCV`, `WebODM` eller egen pipeline.
- Denne varianten gjør det mulig å stabilisere UI og brukerflyt først, og så bytte ut motoren bak senere.

## Neste steg

- erstatte placeholder `result_frames` med ekte frame-uttrekk
- koble metadata mot video/telemetri i stedet for syntetisk rute
- vurdere persistens i database når review og historikk blir viktigere
- koble videre mot processing-sporet for ODM/WebODM der det gir mening
