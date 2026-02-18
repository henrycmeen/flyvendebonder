# FVB-017 – Jordsmonn som kartlag (overlay/heatmap)

## Målet
Gi bonden et visuelt lag for jordsmonn i kartet i stedet for kun tekst i punktliste/metadata.

## Område
UI/UX og datavisualisering i beslutningsflaten.

## Status
Ny, enkel MVP-plan.

## Bakgrunn
- Backend bruker i dag punktbasert oppslag mot NIBIO:
  - `photo_soil_wms_url` / `photo_soil_wms_layers`
  - `photo_soil_wms_layer_fields`
- Kartvisning har i dag egen fotopunkt-rendering, men mangler et dedikert jordsmonn-lag/overlay.
- Bruker ønsker i praksis å se jordsmonn visuelt på kartflaten.

## Forslag (inspirasjon + praktisk plan)
1. Start med **overlay-tilstand** (ingen full heatmap først):
   - Legg egen map-lag-toggle i kartpanelet: `showSoilLayer`.
   - Render en WMS tile-layer fra NIBIO med egen pane/opasitet (`0.4–0.6`).
   - Vis alltid en enkel etikett “Jordsmonn overlay (eksperimentell)”.
2. Håndtering av datatyper:
   - Hvis WMS gir klassifikasjoner, bruk visning “klasser” (fargekategorier), ikke numerisk heatmap.
   - Hvis tilgjengelig, evaluer senere om jordsmonnsklasse kan mappes til score for heatmap.
3. Fallback:
   - Dersom WMS-feiler, vis status i UI + behold dagens punktvisning.
4. Neste del (valgfritt):
   - Klargjør en lokal “heatmap”-modus basert på 5-punkts sampling aggregert til grid/konfidensnivå rundt foto.

## Inspirasjon
- NIBIO-jordsmonn WMS/WFS-konfig som allerede er i API:
  - `https://wms.nibio.no/cgi-bin/jordkvalitet` (`Jordkvalitet`)
  - `https://wfs.nibio.no/cgi-bin/jordkvalitet`

## Akseptansekriterium
- Ny karttoggle for jordsmonn overlay finnes i map UI.
- Når påslått vises jordlag på riktig koordinatsystem med justerbar opasitet.
- Viser tydelig status for load/error av laget (inkl. timeout/feil).
- Brukeren kan skru av/på uten å endre fotoliste- og analysetekst.
- Lagrede foto-verdier (`soil_class`) forblir uendret; overlay er et separat visualiseringstrinn.

## Avgrensning (for nå)
- Ikke bygge ny vektet raster-pipeline i MVP.
- Ikke endre backend-analysealgoritmer nå; kun visning/overlay.
