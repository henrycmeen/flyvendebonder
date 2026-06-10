# Ortofoto tiles v1

`FLY-128` etablerer en pragmatisk første tile-basert ortofoto-løype for Flyvendebønder.

Målet er å gå bort fra at kartet må laste ett stort preview-bilde per ortofoto. Første versjon bruker statiske XYZ-tiles (`z/x/y.webp`) som kan serveres direkte fra webrooten sammen med dagens frontend-assets.

## Valgt v1-retning

- Behold ODM GeoTIFF/COG som canonical rasterkilde.
- Generer en lett web-leveranse som statiske WebP-tiles.
- Registrer tilesettet i `apps/web-app/src/lib/orthophoto-overlays.ts` via `tileLayer`.
- La kartet bruke `L.tileLayer` når `tileLayer` finnes, og falle tilbake til `L.imageOverlay` for eldre ortofoto.

Dette gir lavere datamengde ved oversikt og gjør det mulig å levere høyere detalj ved innzoom uten å laste hele ortofotoet som én bildeflate.

## Prototype

Første committede prototype er `jorde-9-orthophoto`:

- tilemappe: `apps/web-app/public/dev-overlays/jorde-9-orthophoto-tiles/`
- zoom: `14-19`
- tile count: `300`
- tile payload: ca. `4.8 MB`
- registrert i manifestet som `tileLayer`

Metadata viser hvorfor denne er egnet som første kandidat:

- canonical kildebredde: `14324 px`
- dagens previewbredde: `2400 px`
- kvalitetstap/skalafaktor: `5.97x`

I denne checkouten finnes ikke original ODM GeoTIFF lokalt. Det committede prototypetilesettet er derfor generert fra eksisterende preview (`sourceKind: "preview"`), slik at appen kan verifisere tile-kontrakten og tile-lasting. Når GeoTIFF-en er tilgjengelig, kjøres samme script mot canonical kilde for reelt detaljløft, typisk med `maxZoom` rundt `21` for `jorde-9`.

## Kommandoer

Bygg prototypen fra dagens preview:

```bash
apps/backend-api/.venv/bin/python scripts/build-orthophoto-tiles.py \
  apps/web-app/public/dev-overlays/jorde-9-orthophoto.webp \
  apps/web-app/public/dev-overlays/jorde-9-orthophoto.json \
  apps/web-app/public/dev-overlays/jorde-9-orthophoto-tiles \
  --id jorde-9-orthophoto \
  --min-zoom 14 \
  --max-zoom 19
```

Bygg fra canonical ODM GeoTIFF når den finnes lokalt:

```bash
apps/backend-api/.venv/bin/python scripts/build-orthophoto-tiles.py \
  .processing/odm/jorde-9/odm_orthophoto/odm_orthophoto.tif \
  apps/web-app/public/dev-overlays/jorde-9-orthophoto.json \
  apps/web-app/public/dev-overlays/jorde-9-orthophoto-tiles \
  --id jorde-9-orthophoto \
  --min-zoom 14 \
  --max-zoom 21
```

`scripts/sync-orthophoto-overlays.py` tar med `*-tiles/manifest.json` i TypeScript-manifestet når tilesettet finnes.

## Videre vurdering

Statiske XYZ-tiles er riktig første steg fordi de passer dagens deploy: statisk webroot på Mac mini og ingen ny runtime-tjeneste. For større mengder ortofoto bør vi vurdere:

- PMTiles som ett filbasert leveranseformat med færre filsystemobjekter.
- COG + tile-server/TiTiler-lignende løsning hvis vi trenger dynamisk styling, bandvalg eller analyse.
- Cache-policy og deploystørrelse når flere ortofoto får z20/z21-tiles.
