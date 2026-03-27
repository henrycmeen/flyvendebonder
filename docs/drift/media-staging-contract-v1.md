# Media Staging Contract v1

`HEN-76` innfører en liten staging-kontrakt for blandet bilde-/video-opplasting før endelig import.

## Mål

- la backend ta imot én blandet opplasting med bilder, video og ukjente filer
- lagre et stabilt manifest som frontend kan lese før brukeren bekrefter import
- gjøre ugyldige filer synlige i manifestet i stedet for å feile stille

## Endepunkter

- `POST /api/v1/media-staging-jobs`
  - multipart-opplasting med ett eller flere `files`
  - oppretter stagingjobb og lagrer filene under `storage/media-staging/{job_id}/`
- `GET /api/v1/media-staging-jobs`
  - lister siste stagingjobber for innlogget bruker
- `GET /api/v1/media-staging-jobs/{job_id}`
  - henter manifest for én stagingjobb

## Manifest v1

Top-level per jobb:

- `job_id`
- `source`
- `status`
- `counts.total`
- `counts.image_count`
- `counts.video_count`
- `counts.unknown_count`
- `counts.rejected_count`
- `items[]`

Per item:

- `id`
- `filename`
- `mime`
- `bytes`
- `checksum`
- `media_kind` (`image`, `video`, `unknown`)
- `status` (`staged`, `rejected`)
- `error_detail`

## Bevisste avgrensninger

Dette ligger eksplisitt igjen til `HEN-77`:

- finalize-steg som materialiserer stagingjobb til fotoimport og videojobber
- kobling til album eller andre samleobjekter
- delvis retry eller re-klassifisering av enkeltsfiler
- rikere validering enn enkel filtype-/mime-klassifisering
