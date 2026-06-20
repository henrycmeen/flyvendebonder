# GeoJSON-kontrakt v1

Denne notaten beskriver første versjonerte GeoJSON-kontrakt i Flyvendebønder for vektordata.

## Mål

Etablere én tydelig og gjenbrukbar eksportretning for felt, polygoner og rutedata uten å blande dette sammen med STAC-sporet for raster og avledede artefakter.

## Omfang i v1

Eksport:
- `GET /api/v1/fields/export.geojson`
- `GET /api/v1/flight-missions/{mission_id}/route.geojson`

Import:
- `POST /api/v1/fields`
- `PATCH /api/v1/fields/{field_id}`

## Kontrakt

- Format: GeoJSON `FeatureCollection`
- Kontraktnavn: `flyvendebonder.geojson`
- Versjon: `v1`
- CRS-regel: `OGC:CRS84`
- Koordinatrekkefølge: `longitude, latitude`

Vi bruker ikke `crs`-objekt i payloaden. I stedet følger vi GeoJSON/RFC 7946-praksis og beskriver CRS-regelen i `flyvendebonder_contract`.

## Toppfelter

Alle eksportpayloads kan inneholde:
- `type`
- `features`
- `flyvendebonder_contract`

`flyvendebonder_contract` beskriver:
- navn
- versjon
- ressurs
- eksportsti
- relevante importstier
- CRS-regel
- kort notat om at STAC brukes separat for raster/flight-artefakter

## Feltdefinisjoner i v1

Felt-eksport inkluderer blant annet:
- `field_id`
- `property_id`
- `name`
- `source`
- `status`
- `area_m2`
- `area_ha`
- `created_at`
- `updated_at`

Kildeverdier og proveniens skal følge `docs/drift/kildepolicy-v1.md`. For Geonorge-teiger betyr det at eksporten bør kunne forklare kilde, hentetid og eventuell kildeoppdatering. Manuelt tegnede felt og importerte felt skal ikke presenteres som Geonorge-data uten eksplisitt kilde.

Rute-eksport viderefører feature-properties fra oppdragsgeneratoren, som:
- `field_id`
- `field_name`
- `kind`
- `altitude_m`
- `line_spacing_m`
- `waypoint_spacing_m`
- `route_angle_deg`
- `sequence`

## Grense mot STAC

GeoJSON-sporet i denne saken er for:
- felt
- polygoner
- ruter
- annen lett vektorgeometri

STAC-sporet i `HEN-55` er fortsatt for:
- rasterprodukter
- tiles
- thumbnails
- metadata-artefakter
- flight-/processing-bundles
