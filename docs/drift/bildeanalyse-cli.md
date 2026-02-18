# CLI for bildeanalyse (dronefoto)

## Verktøy som fungerer godt
- `exiftool`: leser GPS, dato, kamera, retning, høyde og annen metadata.
- `ImageMagick` (`magick`/`identify`): histogram, kontrast, skarphet, batch-konvertering.
- `OpenCV` (Python): enkel deteksjon/segmentering og bildemålinger.
- `GDAL` (`gdalinfo`, `gdal_translate`): nyttig for georefererte raster (GeoTIFF/ortofoto).
- `ffprobe`/`ffmpeg`: metadata og frame-ekstraksjon for video.

På denne maskinen er minst følgende allerede tilgjengelig:
- `exiftool`
- `ffprobe`

## Eksempler
### 1) Metadata-rapport for hele mappen
```bash
./scripts/analysebilder-report.sh \
  "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"
```

### 2) Full QC-kjede (stabilitets-kjøring)
```bash
./scripts/cycle-metadata-qc.sh \
  "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  .metadata-qc-runs \
  0
```

Dette lager:
- `photo_qc_report.json`
- `photo_qc_report.csv`
- `manifest.json`
- `photo_metadata_report.json`

### 3) Regenerer demo-data fra Analysebilder
```bash
./scripts/import-analysebilder-to-demo.py \
  --source "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  --per-folder 3
```

Dette oppdaterer:
- `apps/demo-fotokart/assets/photos/meen-*.jpg`
- `apps/demo-fotokart/data/photos.geojson`
- `apps/demo-fotokart/data/story.json`

### 4) Importer bilder til ny backend-database
```bash
cd apps/backend-api
python3 import_photos.py \
  "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"
```

Dette skriver:
- metadata til SQLite (`apps/backend-api/data/flyvendebonder.db`)
- bildefiler/derivater til `apps/backend-api/storage/photos/`
