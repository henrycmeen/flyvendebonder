# Demo-fotokart (`/demo/`)

Statisk frontend-demo med Leaflet + marker clustering.
UI er nå kart-først: full kartflate med tidslinje nederst.
Inkluderer nå NIBIO Gårdskart-overlegg for eiendom (`4003-70/17/0`) med automatisk `jobId`-fornying.
Teknisk feilsøking kan gjøres i panelet `Teknisk logg` i toppen av demoen.

## Oppdatere med nye dronebilder
```bash
./scripts/import-analysebilder-to-demo.py \
  --source "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  --per-folder 3
```

## Data-kontrakt

`data/photos.geojson`
- `type`: `FeatureCollection`
- `features[].geometry.type`: `Point`
- `features[].properties`:
  - `id` (string)
  - `title` (string)
  - `date` (ISO dato)
  - `tags` (string[])
  - `chapter` (string)
  - `thumbnail` (path)
  - `image` (path)
  - `caption` (string)

`data/story.json`
- Beholdes for videre arbeid, men brukes ikke aktivt i tidslinje-UI akkurat nå.

## Deep-links
- `?date=<YYYY-MM-DD>`
- `?photo=<id>`
- `?mode=cumulative` eller `?mode=day`
