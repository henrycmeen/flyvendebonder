# V3: originalkilder, regenerert vår og august-r13

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

## Regenerert vårprodukt 5. oktober 2026

Den tapte våroriginalen er fortsatt ikke gjenfunnet. De 20 ekte JPEG-kildene
ble gjenfunnet på kontrollmaskinen i `/Users/henmee/Downloads/flyvendebønder vår-test/jorde 4`
og overført med filvise SHA256 til Mac mini. Alle er DJI FC8482, 4032 × 2268,
med EXIF-dato 31. mars 2026 09:54:35–09:55:36, GPS og nedovervendt kamera.
Dette muliggjør et nytt regenerert produkt, ikke gjenoppretting av gammel filidentitet.

Ny registrering: `jorde-4-20260331-regenerated-v3`. Stabil TIFF:
`/Volumes/Projects/Active/Flyvendebonder/exports/orthophoto/2026-03-31-jorde4-regenerated-v3/jorde-4-20260331-regenerated-v3.tif`.
SHA256 er `b944200b9ee949aaf4c8eb01269abd4206b3c2d1eb87c4271441022f04a12492`,
verifisert fra filen og leveransens SHA256SUMS; størrelse 64 120 024 byte.
Inputmanifest, run-config og logg følger eksporten. Kjørt med native linux/arm64
`opendronemap/odm@sha256:f3503aab96ab09144e85a17f4e57dbe3883e65ca7542b1a1be12898e02be5a10`,
5 cm, fast orthophoto, medium point cloud/high features, to samtidige jobber og
uten teksturert 3D-modell/rapportgenerering. Prosessen avsluttet med exit 0.

`opensfm/reconstruction.json` og `odm_report/shots.geojson` inneholder 19 av 20
bilder. `DJI_20260331095435_0114_D.JPG` ble ikke rekonstruert. Exit 0 er ikke
bevis for at alle inputbilder ble brukt. `options.json` har `gcp=null` og
`align=null`; bildenes GPS er georefereringsgrunnlaget. Ingen ekstern
registrering mot august eller kontrollpunkter er dokumentert.

| Felt | Verifisert verdi |
| --- | --- |
| CRS / format | EPSG:32632, uint8 RGBA, nodata ikke satt |
| Raster | 14 142 × 7 238 |
| Affin transform | `[0.04999544793220022, 0, 537990.1397654371, 0, -0.04999308170929333, 6559782.655210019]` |
| UTM-ramme V/S/Ø/N | 537990,139765 / 6559420,805285 / 538697,175390 / 6559782,655210 |
| Gyldig alpha og dataset mask | 32 261 608 av 102 359 796 piksler, 31,52 % av rasterrammen |
| Webpreview | 1600 × 832, EPSG:3857, nearest, originalens alpha bevart |

Rasterrammen på ca. 255 841 m² ligger helt innen august-r13-rammen. Bare
31,52 % av vårens ramme har gyldige piksler. Verken full bbox-overlapp eller
maskefraksjonen dokumenterer registrering eller full felles gyldighetsdekning.
Ny preview og metadata er avledet fra denne eksakte TIFF-en med egne bounds;
det gamle vårmanifestet og previewen er bevart uten endringer.

Tre koordinater ble prøvd gjennom eksisterende `sample_orthophoto_color`
med 21 × 21 vindu, eksplisitt overlay-root og `allow_preview=False`:

| Breddegrad / lengdegrad | Vår middel-RGB | August middel-RGB |
| --- | --- | --- |
| 59.17499792204856 / 9.674509030253068 | 199,0 / 179,9 / 161,0 | 109,9 / 119,4 / 65,0 |
| 59.17479609284547 / 9.672041974693194 | 179,8 / 167,2 / 149,8 | 149,3 / 132,4 / 108,4 |
| 59.17479184391279 / 9.672863209570519 | 101,6 / 87,7 / 76,1 | 126,8 / 112,1 / 89,0 |

Alle seks prøver ga canonical EPSG:32632, `native-crs-affine-rgb-v1`, 441
gyldige piksler, ingen klipping og identisk resultat ved gjentakelse. Dette
viser teknisk native prøvetaking på begge datoer ved tre oppgitte koordinater.
RGB-forskjellene er ikke kalibrert endring, avlingsscore eller bevis for at
koordinatene treffer samme fysiske detalj uten registreringskontroll.

## Gjenstående bevis

Den tapte originalen er fortsatt en historisk kildebegrensning. Det regenererte
produktet har egen hash, CRS/transform og gyldighetsmaske. Videre trengs kontroll
av felles gyldig pikseldekning på jorde 4 og målt registrering mellom datoene. En bbox eller korrekt
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
på kontrollmaskinen: `work/v3-context/v3-r13-repeat.json`. API-ruting er også prøvd
på isolert 8825 med ec43870: autentisert 200 fra august-r13 har
source.algorithm_version=native-crs-affine-rgb-v1, canonical EPSG:32632,
21×21/441 gyldige piksler og samme RGB-statistikk. Vårens jorde 4 gir 503
og krever eksplisitt preview-valg. Bevis: work/v3-context/v3-current-raster-api.json
på kontrollmaskinen. Dette er ett punkt og ikke registrering mellom datoene.
