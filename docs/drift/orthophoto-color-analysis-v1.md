# Ortofoto fargeanalyse v1

## Scope

Fargeanalyse v1 er et inspeksjonsverktøy i kartet. Brukeren slår på `Fargeanalyse`, klikker i et synlig ortofoto og får relative RGB-indikatorer fra en liten prøveflate.

V1 har to prøvebaner:

- `Web-overlay`: direkte piksel-lesing fra bildeoverlayet som faktisk vises i nettleseren.
- `Backend/ortofoto`: API-prøve fra overlay-metadata og rasterfil. Backend leser normalt publiserte overlay-filer fra webrooten under `/Users/henrymeen/srv/www/flyvendebonder/app/dev-overlays`, foretrekker kanonisk raster når `source_file` finnes lokalt, og faller ellers tilbake til preview-raster for pilotens dev-overlays.

Dette er ikke agronomisk rådgivning, sykdomsdiagnose eller gjødslingsgrunnlag. Verdiene er ment for rask sammenligning innen samme ortofoto og samme visningskontekst.

## Beregning

- Prøveflate: `21 x 21` kildebildepiksler rundt klikkpunktet.
- Mapping: Leaflet-projeksjon fra lat/lng til bildepiksel via overlay-bounds, ikke lineær latitude-interpolering.
- Gyldige piksler: RGBA-piksler med alpha over no-data terskel.
- RGB-statistikk: mean og median for gyldige piksler.
- Indekser: ExG, VARI, NGRDI, GLI og NDYI beregnes per gyldig piksel før aggregering.
- Kvalitetsflagg: kantklipping, få piksler, transparente/no-data piksler, mørkt/skygge, lyst/overeksponert og mulig jord/bakgrunn.
- API: `GET /api/v1/orthophotos/{overlay_id}/color-sample?lat=...&lng=...&sample_size_px=21`.
- API-responsen inkluderer overlay, prøvekilde, rasterstørrelse, GSD når UTM-bounds finnes, bildepiksel, RGB-statistikk, indekser og kvalitetsflagg.

## Kjente begrensninger

- Browser-sampleren kan bare lese live `ImageOverlay`-bilder. Tiled overlays bruker backend-prøve.
- Backend-prøven bruker kanonisk raster bare når `source_file` i overlay-metadata finnes lokalt for backend-prosessen. I drift brukes publiserte webroot-overlays; i repo/dev uten lokal ODM-raster brukes preview-rasteret, og UI viser dette som `Backend/ortofoto`.
- Canvas kan bli blokkert av CORS hvis bildekilden ikke tillater piksel-lesing.
- Web-ortofotoet kan være nedskalert eller fargekorrigert; verdiene er derfor relative til visningsbildet.
- Ingen prøver lagres i v1.

## Videre vei

Presis backend/COG-sampling bør bli neste spor:

1. Legg kanoniske COG/ODM-rastere på en stabil backend-tilgjengelig sti.
2. Utvid overlay-metadata slik at `source_file` peker til den stabile stien i drift, ikke til en lokal arbeidsmappe.
3. Bytt preview-fallback til bare eksplisitt pilot/dev-modus når kanonisk raster mangler.
4. Legg til pixelmapping-test mot ekte georeferert COG når rasterio/GDAL blir en bevisst backend-avhengighet.
