# ODM-løype v1 for manuelle jordeflyginger

## Mål
Dette er første enkle prosess for å gjøre et manuelt flydd jord om til:
- ortofoto
- DSM
- punktsky

Vi bygger ikke dette inn i appen ennå. Målet er en repeterbar CLI-løype som kan kjøres per jordemappe.

## Inputstruktur
Anbefalt kilde nå:
- én mappe per jord
- kun geotaggede `JPG`-bilder i første runde

Eksempel:
```bash
/Users/henmee/Downloads/flyvendebønder vår-test/jorde 3
```

Ikke bruk i første runde:
- `.LRF`
- `.SRT`
- video

## Krav
- Docker installert lokalt
- Mini 4 Pro-bilder med GPS og høyde i EXIF

## Standardkommando
Kjør fra repo-roten:

```bash
./scripts/run-odm-jorde.sh "/Users/henmee/Downloads/flyvendebønder vår-test/jorde 3"
```

Scriptet:
- lager et ODM-prosjekt under `.processing/odm/<prosjektnavn>`
- kopierer bildene inn i `images/`
- kjører `OpenDroneMap` via Docker

## Output
Forventet output ligger under:

```bash
.processing/odm/<prosjektnavn>/
```

Viktigste filer:
- `odm_orthophoto/odm_orthophoto.tif`
- `odm_dem/dsm.tif`
- `odm_georeferencing/odm_georeferenced_model.laz`

## Første anbefalte rekkefølge
Kjør ett jord om gangen.

Anbefalt testrekkefølge:
1. `jorde 3`
2. `jorde 4`
3. `jorde 6 (M48)` hvis vi vil sammenligne mot 48 MP

`M48` bør ikke være første test, siden det ofte blir tyngre uten å være beste første sanity-check.

## Justeringer
Scriptet støtter enkle miljøvariabler:

```bash
ODM_ORTHO_RESOLUTION_CM=2
ODM_PC_QUALITY=medium
ODM_FEATURE_QUALITY=high
ODM_MATCHER_NEIGHBORS=8
ODM_SKIP_REPORT=1
ODM_EXTRA_ARGS="--min-num-features 12000"
```

Eksempel:

```bash
ODM_ORTHO_RESOLUTION_CM=1 \
ODM_PC_QUALITY=high \
ODM_FEATURE_QUALITY=high \
ODM_MATCHER_NEIGHBORS=12 \
ODM_EXTRA_ARGS="--min-num-features 12000" \
./scripts/run-odm-jorde.sh "/Users/henmee/Downloads/flyvendebønder vår-test/jorde 4"
```

Dette er anbefalt som en balansert profil:
- god kvalitet
- merkbart bedre enn første raske sanity-run
- uten å gå helt til `ultra`

For å bare forberede prosjektet og verifisere Docker-kommandoen:

```bash
ODM_DRY_RUN=1 \
./scripts/run-odm-jorde.sh "/Users/henmee/Downloads/flyvendebønder vår-test/jorde 3"
```

For å kjøre alle jordemapper i en rotdir, men hoppe over `jorde 3` og `jorde 6 (M48)` som allerede er testet:

```bash
./scripts/run-odm-jorder-batch.sh "/Users/henmee/Downloads/flyvendebønder vår-test"
```

## Bygg kart-overlays av ferdige ortofoto
Når ett eller flere ODM-prosjekter er ferdige, kan ortofotoene konverteres til lettere webfiler og registreres som kartlag:

```bash
./scripts/sync-orthophoto-overlays.py
```

Det scriptet:
- finner ferdige ortofoto under `.processing/odm/*/odm_orthophoto/odm_orthophoto.tif`
- bygger `.webp` med transparent bakgrunn der ortofotoet støtter alpha
- leser opptaksdato fra kildebildene
- skriver metadatafiler under `apps/web-app/public/dev-overlays/`
- oppdaterer `apps/web-app/src/lib/orthophoto-overlays.ts`

Bare for ett prosjekt:

```bash
./scripts/sync-orthophoto-overlays.py --project jorde-3
```

## Kjent ODM-problem akkurat nå
`opendronemap/odm:latest` på denne maskinen fullfører selve prosesseringen, men kan krasje helt til slutt i `odm_report` på en `NumPy/GDAL`-konflikt når preview-rapporten lages.

Derfor hopper scriptet nå over rapportsteget som standard med:

```bash
--skip-report
```

Det påvirker ikke de viktigste outputfilene vi faktisk trenger:
- ortofoto
- DSM
- punktsky

## Hva vi gjør videre hvis dette fungerer
Når vi har god output, er neste spor:
- publisere ortofoto som kartlag i `Kart`
- bruke `DSM`/høydegrunnlag for senere 2.5D/3D-visning
- koble dette mot [HEN-100](https://linear.app/henrymeen/issue/HEN-100/kart-v2-loft-ortofoto-fra-bakken-til-enkel-3d-visning-i-kartet)

## Viktig avgrensning
Dette er en prosesseringsløype, ikke en produktintegrasjon.
Vi prøver først å få:
- stabile inputmapper
- repeterbar prosess
- brukbare raster/høydefiler

Deretter bygger vi opplevelsen i appen.
