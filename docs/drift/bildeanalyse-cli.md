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

### 2) Regenerer demo-data fra Analysebilder
```bash
./scripts/import-analysebilder-to-demo.py \
  --source "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  --per-folder 3
```

Dette oppdaterer:
- `apps/demo-fotokart/assets/photos/meen-*.jpg`
- `apps/demo-fotokart/data/photos.geojson`
- `apps/demo-fotokart/data/story.json`
