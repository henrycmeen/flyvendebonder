# V3: originalkilder og august-r13

Kontrollert på Mac mini 5. oktober 2026. Dette er kildeverifikasjon for en lokal
V3-kandidat, ikke feltaksept eller registrering mellom opptaksdatoer.

## Augusteksporten

Fil: `/Volumes/Projects/Active/Flyvendebonder/exports/orthophoto/2026-08-02-best-effort-r13/flyvendebonder-ortofoto-5cm.tif`.

| Felt | Verifisert verdi |
| --- | --- |
| SHA256 | `2a0d323e232e3fa93c28eea86ac724a0bb020351c034950812621c80267b2a54` |
| Filstørrelse | 669 720 545 byte |
| CRS | EPSG:32632 |
| Originalraster | 20 358 × 21 862, uint8 RGBA, nodata 0 |
| Pixelstørrelse | 0,049979248319360924 × 0,049983731325944275 meter |
| Affin transform | `[0.049979248319360924, 0, 537695.1076200273, 0, -0.049983731325944275, 6559886.10678644]` |
| UTM-ramme V/S/Ø/N | 537695,107620 / 6558793,362452 / 538712,585157 / 6559886,106786 |
| WGS84-ramme V/S/Ø/N | 9,659306479 / 59,166543258 / 9,677295255 / 59,176447396 |

Hashen er beregnet fra filen og samsvarer med leveransens SHA256SUMS, STATUS.json
og CLOSEOUT.md. Leveransen gjelder 2. august 2026. Dokumentasjonen beskriver
best-effort kartlegging fra opptaksruten, med transparente hull og synlige tone-
og kantforskjeller. Det er ikke radiometrisk kalibrert grunnlag for avlingsanalyse.

## Eksisterende manifest og avvik

Vårmanifestet `jorde-4-orthophoto.json` gjelder 31. mars 2026 og 14 043 × 7 069
piksler. Originalen finnes ikke på den gamle absolutte iCloud-stien. Previewen
finnes. August-r13 omslutter vårmanifestets UTM-ramme (ca. 264 445 m²), men
rektangulær overlapp beviser ikke gyldig pikseldekning. Augustfilen kan ikke
brukes som vårmanifestets original.

Det eksisterende `flyvning-2026-08-02-orthophoto.json` beskriver 6 958 × 6 631
piksler og ca. 15 cm GSD. Originalstien `odm_orthophoto.tif` finnes ikke ved
manifestmappen. Previewen finnes. August-r13 har andre grenser og er ikke
verifisert som samme raster med en annen oppløsning. Rektangulært overlapp dekker
93,63 % av det gamle manifestets ramme og 87,42 % av r13-rammen.

Derfor registreres r13 som et eget augustprodukt med egen filidentitet og
geometri. Eksisterende manifest, previewgeometri og tiles beholdes. Den nye
webpreviewen må avledes fra denne eksakte filen, med originalens CRS adskilt fra
previewens EPSG:3857-grid. Originalen kopieres ikke inn i Git.

## Gjenstående bevis

Vårens originaler må gjenfinnes og knyttes til riktig manifest med egen filhash,
CRS/transform og gyldighetsmasker. Deretter trengs konkret kontroll av gyldig
pikseldekning på jorde 4 og registrering mellom datoene. En bbox eller korrekt
native prøvetaking alene er ikke nok til tallfestet endringsanalyse.

## Sampling-versjon

Kandidatens API oppgir `native-crs-affine-rgb-v1` for originalens CRS/affine
prøvetaking og `preview-wgs84-rgb-v1` for eksplisitt omtrentlig preview.
`quantitative_eligible` betyr her at et georeferert uint8 RGB-originalraster kan
prøvetas teknisk. Det godkjenner ikke skygger, radiometrisk kalibrering eller
kvantitativ sammenligning mellom datoer; kvalitetsflagg og kildebegrensninger
må vurderes separat. Ingen datodelta eller agronomisk konklusjon beregnes.

Gjenta-prøve mot den faktiske augustfilen: to direkte servicekall med samme
kilde, 59.173828 / 9.670614 og 21×21 vindu ga identiske resultater; 441 gyldige
piksler, middel-RGB 59,4 / 67,6 / 48,1 og `shadow_risk`. Rasterio 1.5.2.
Vårens original ga fortsatt eksplisitt utilgjengelig kilde. Reproduksjonsresultat
på kontrollmaskinen: `work/v3-context/v3-r13-repeat.json`. API-ruting ble prøvd
separat på isolert 8825 før versjonsfeltet ble lagt til; eksisterende API-test
kontrollerer at versjonsfeltet nå er med i responsen.
