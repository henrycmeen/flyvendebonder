# Demo-fotokart (`/demo/`)

Statisk frontend-demo med Leaflet + marker clustering.

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
- `title` (string)
- `subtitle` (string)
- `chapters[]`:
  - `slug` (string)
  - `title` (string)
  - `description` (string)
  - `focus.lat` (number)
  - `focus.lng` (number)
  - `focus.zoom` (number)
  - `filter.chapter` (string)

## Deep-links
- `?chapter=<slug>`
- `?photo=<id>`
