# Media finalize contract v1

`HEN-77` følger opp staging-kontrakten fra `HEN-76`.

## Mål

- bekrefte én eksisterende `MediaStagingJob`
- materialisere staged bilder gjennom eksisterende fotoimport
- materialisere staged videoer som `VideoJob`
- returnere ett samlet finalize-resultat som kan vises tydelig i UI

## Endepunkt

- `POST /api/v1/media-staging-jobs/{job_id}/finalize`

Endepunktet:

- eier-sjekker stagingjobben
- bruker staging-katalogen som faktisk kildegrunnlag
- kjører bildeimport via eksisterende `run_photo_ingest(...)`
- oppretter videojobber via eksisterende `VideoJob`-løype
- cacher resultatet på stagingjobben slik at enkel retry ikke lager nye duplikater

## Resultatpayload

Finalize-responsen inneholder:

- `job_id`
- `status`
- `import_run_id`
- `image_imported_count`
- `image_skipped_count`
- `video_jobs_created`
- `video_jobs_reused`
- `rejected_count`
- `items`

Hvert item beskriver utfallet for ett staging-item:

- `staging_item_id`
- `filename`
- `media_kind`
- `status`
- `photo_id`
- `video_job_id`
- `detail`

## V1-avgrensning

Denne saken gjør bevisst ikke følgende:

- innfører ikke egen album-modell
- kjører ikke ekte videoanalyse eller frame-uttrekk
- kobler ikke finalize direkte til `FlightCapture`
- løser ikke resumable uploads eller auth-hardening

Det gjør `HEN-77` liten og reviewbar: staging inn, eksisterende domeneobjekter ut.
