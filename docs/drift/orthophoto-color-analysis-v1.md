# Ortofoto fargeanalyse v1

## Scope

Fargeanalyse v1 er et nettleserbasert inspeksjonsverktøy i kartet. Brukeren slår på `Fargeanalyse`, klikker i et synlig ortofoto og får relative RGB-indikatorer fra en liten prøveflate i web-ortofotoet som faktisk vises.

Dette er ikke agronomisk rådgivning, sykdomsdiagnose eller gjødslingsgrunnlag. Verdiene er ment for rask sammenligning innen samme ortofoto og samme visningskontekst.

## Beregning

- Prøveflate: `21 x 21` kildebildepiksler rundt klikkpunktet.
- Mapping: Leaflet-projeksjon fra lat/lng til bildepiksel via overlay-bounds, ikke lineær latitude-interpolering.
- Gyldige piksler: RGBA-piksler med alpha over no-data terskel.
- RGB-statistikk: mean og median for gyldige piksler.
- Indekser: ExG, VARI, NGRDI, GLI og NDYI beregnes per gyldig piksel før aggregering.
- Kvalitetsflagg: kantklipping, få piksler, transparente/no-data piksler, mørkt/skygge, lyst/overeksponert og mulig jord/bakgrunn.

## Kjente begrensninger

- Browser-sampleren kan bare lese live `ImageOverlay`-bilder. Tiled overlays får en eksplisitt utilgjengelig-tilstand inntil backend/COG-sampling finnes.
- Canvas kan bli blokkert av CORS hvis bildekilden ikke tillater piksel-lesing.
- Web-ortofotoet kan være nedskalert eller fargekorrigert; verdiene er derfor relative til visningsbildet.
- Ingen prøver lagres i v1.

## Videre vei

Backend/COG-sampling bør bli neste presise spor:

1. Les samme ortofoto fra kanonisk raster/COG i backend.
2. Bruk samme overlay-utvalg og bounds-kontrakt som frontend.
3. Returner prøveflate, oppløsning/GSD når kjent, RGB-statistikk, indekser og kvalitetsflagg via API.
4. La frontend vise om prøven kommer fra web-overlay eller backend/COG.
