# Open source CLI-verktøy for landbruksrettet dronebildeanalyse

## Executive summary

Landbruksfokus (agronomi/avlingsoppfølging/plantestress) gjør at **ortomosaikk + høydekart (DSM/DTM) + beregnede indekskart (NDVI/andre VI)** er de mest praktiske sluttproduktene fra dronebilder. For en ren terminalbasert arbeidsflyt peker tre verktøygrupper seg ut som “minste robuste kombinasjon”:

**Anbefalt “først å prøve” (2–3 verktøy):**
1. **OpenDroneMap (ODM)** som fotogrammetri-motor for å lage georefererte ortofoto, punktsky og DEM/DSM/DTM fra dronebilder (inkl. multispektral og termisk i økosystemet). citeturn18search6turn18search1turn18search24  
2. **Orfeo ToolBox (OTB)** som CLI-motor for å beregne vegetasjons-/radiometriske indekser (f.eks. NDVI) fra multispektrale ortomosaikker og for generell fjernmåling-rasterbehandling som passer landbruk. citeturn22search3turn7view0turn22search5turn22search0  
3. **ExifTool** (evt. sammen med **Exiv2**) for systematisk metadata-/EXIF-QA (GPS, høyde, tidsstempler, kameramodell) før prosessering og for sporbarhet i produksjon. citeturn2search3turn3search0turn3search4turn9view0  

**Når du trenger høyest fotogrammetrisk kontroll** (prosjekter med krevende geometri, GCP/akselerasjon, spesialtilfeller): **MicMac** er et svært kapabelt CLI-alternativ, men med høyere kompleksitet og brattere læringskurve (flere delkommandoer, flere parametre). citeturn9view0turn10search8turn10search12  

**Presis georeferering i landbruk** krever ofte bedre enn “drone-GPS alene”. For GCP-arbeidsflyt er **Find‑GCP** nyttig dersom du vil bruke ArUco-markører og automatisk generere GCP‑fil til ODM/WebODM (CLI-verktøy). citeturn19view0turn20search0  

**Lisens-/produktvalg**: ODM er **AGPLv3** (sterk copyleft og “nettverksbruk”-krav ved modifisert drift som tjeneste), mens OTB (Apache‑2.0) og GDAL (MIT) er “snillere” for integrasjon og kommersialisering. citeturn16search6turn23search0turn22search0turn25search0  

---

## Hva “landbruksanalyse” typisk krever fra CLI-verktøy

I landbruk er det normalt tre lag av funksjonelle behov:

**Geometri og basisprodukter (fotogrammetri):**
- Ortomosaikk (RGB og/eller multispektrale bånd) og DEM/DSM/DTM til kartlegging av felt, jordstruktur, drenering og biomasse-/høydeproxyer. citeturn18search14turn18search6  
- Arbeidsflyt som tåler “mange bilder” og varierer i overlap/lysforhold, gjerne med støtte for “split/merge” ved store datasett. citeturn16search12turn18search1  

**Radiometri og agronomiske avledninger (multispektral/termisk):**
- Vegetasjonsindekser: f.eks. NDVI beregnet fra NIR og rød kanal. citeturn14search0turn7view0  
- Reproduserbar og dokumenterbar beregning i CLI (scripts, logg, parametre). citeturn22search5turn14search1  

**Metadata, kvalitet og sporbarhet:**
- Systematisk metadatauttak fra bilder for QA (GPS, høyde, tidspunkt, kamera) og for å identifisere dataproblemer før tung prosessering. citeturn2search3turn24search1  
- Validering: kontrollpunkter (GCP) vs “check points” for uavhengig nøyaktighetsmåling; rapportering med RMSE/standarder. citeturn17search33turn17search2turn23search1  

---

## Prioritert verktøyliste med landbruksrelevans

Tabellen under er ordnet etter “praktisk nytte i landbruks-POC”, deretter produksjonsrelevans. (Noen verktøy er *motorer*, andre er *byggesteiner* i en pipeline.)

| Verktøy (CLI) | Hovedfunksjoner (landbruk) | Multispektral / NDVI | Georeferering / mosaikk | Lisens (implikasjoner kort) | GPU-støtte | Modenhet/community (proxy) | Anbefalt for |
|---|---|---|---|---|---|---|---|
| **ODM (OpenDroneMap)** | Ortomosaikk, punktsky, DEM/DSM/DTM fra dronebilder (scriptbart) | Multispektral parametere inkl. radiometrisk kalibrering i økosystemet | Georefererte produkter; GCP-støtte gjennom workflow | **AGPL‑3.0** (sterk copyleft; nettverksbruk av modifisert versjon utløser kildekode-tilbud til brukere) citeturn16search6turn23search0turn23search1 | Offisiell dok sier GPU “har ingen effekt” på ytelse; andre deler av økosystemet tilbyr CUDA-varianter → test i egen rigg citeturn18search1turn16search31 | Stor repo/bruk: “de-facto standard” i økosystemet; mange stjerner citeturn18search6turn15view1 | Pilot → produksjon |
| **MicMac (mm3d)** | Fotogrammetri med høy kontroll (tie points, orientering, DEM/ortho) | Kan brukes, men ofte mer håndarbeid | Sterk geometri/GCP/koordinater via PROJ | **CeCILL‑B** (mer “permissiv” enn GPL-familien; brukt i forsknings-/kartmiljø) citeturn9view0 | Ikke primært GPU-fokusert i install- og basisdocs (CPU/parallel) citeturn9view0 | Høy modenhet i fotogrammetri-miljø; lang historikk citeturn10search12turn9view0 | Pilot (avansert) → produksjon (ekspert) |
| **OTB (Orfeo ToolBox)** | Fjernmåling/indekser/ortho-rectification/klassifisering; sterk for indekskart i landbruk | NDVI via BandMath og egne indeks‑apper | Raster- og geoverktøy; CLI-launchere | **Apache‑2.0** (permissiv med patentklausul; egnet for integrasjon) citeturn22search0turn23search3turn22search8 | Ikke sentralt i docs (CPU/streaming/multithread i økosystemet) citeturn22search11turn22search5 | Modent verktøy, støttes av OSGeo-miljøet citeturn22search19turn22search13 | Pilot → produksjon |
| **GRASS GIS (CLI)** | Rasteralgebra (NDVI), indeksmoduler (i.vi), geodataanalyse | NDVI via r.mapcalc / i.vi | Kan kombineres med GDAL/PROJ | **GPL (>=v2)** (copyleft; påvirker redistribusjon av integrert programvare) citeturn14search6turn23search9 | Ikke GPU-fokusert i basismanualer citeturn14search0turn14search1 | Svært modent GIS-miljø citeturn14search6 | Pilot → produksjon (GIS-tungt) |
| **GDAL (CLI)** | Mosaikk, reprojeksjon/warp, GeoTIFF/GCP/metadatahåndtering | Indekser via gdal_calc (script) + rasterpipelines | gdalbuildvrt/gdal_merge + georeferering | **MIT** (permissiv; lett å integrere) citeturn25search0turn25search1 | Ikke GPU-fokusert i kjerne-CLI citeturn12search0turn12search2 | Ekstremt modent; OSGeo-prosjekt citeturn25search1turn25search2 | Produksjon (byggestein) |
| **PDAL (CLI)** | Punktsky-prosessering, filtrering, rasterisering (DTM/DEM) | Indirekte (høydeprodukter) | Kan lage raster via writers.gdal | **BSD** (permissiv) citeturn13search3turn25search3 | Ikke typisk GPU i basis-CLI; pipeliner/stream mode citeturn13search0turn13search33 | Modent; ~1.3k stjerner citeturn25search3 | Pilot → produksjon (punktsky) |
| **Find‑GCP (gcp_find.py)** | Automatisk ArUco‑deteksjon og GCP‑filgenerering til fotogrammetri | Ikke NDVI; men viktig for nøyaktighet | Lager GCP-listing (ODM/VisualSfM/Meshroom) | **GPL‑2.0** (copyleft) citeturn20search0turn19view0 | Avhenger av OpenCV | Mindre, men aktivt brukt i ODM-økosystem citeturn20search19turn19view0 | Pilot/produksjon (GCP-automatisering) |
| **CloudODM (odm CLI-klient)** | Kjøre ODM via NodeODM API (remote/«cloud») | Avhenger av back-end | Sender jobber, henter resultater | **GPL‑3.0** (copyleft) citeturn16search2 | Avhenger av backend; kan bruke GPU‑nodevarianter i NodeODM | Mindre repo | Pilot (skaleringsforsøk) |
| **ExifTool / Exiv2 (CLI)** | Metadatauttak, QA, evt. skriving av metadata | Indirekte (metadata/QA) | Understøtter sporbarhet og feilsøking | ExifTool: “samme vilkår som Perl”; Exiv2: CLI for Exif/IPTC/XMP citeturn3search0turn24search1 | Ikke relevant | Svært mye brukt | Produksjon (QA/forvalting) |

**Merk:** verktøy som **COLMAP**, **openMVG/openMVS** og **Meshroom** er sterke for 3D‑rekonstruksjon, men er ofte mindre “rett på landbrukskart (GeoTIFF/DEM/plot‑analyse)” enn ODM/MicMac + GDAL/OTB. COLMAP er samtidig interessant om du vil bygge egne pipeline‑steg eller jobbe utenfor ODM‑økosystemet. citeturn11view0turn8search2turn21search7turn21search4  

---

## Teknisk kravbilde for landbruks-arbeidsflyt

### Maskinvare og ytelse

**ODM (fotogrammetri)** har eksplisitte minneanbefalinger etter antall bilder (typisk lineært økende), og dokumentasjonen gir en tabell fra ~4 GB (40 bilder) til ~128 GB (2500 bilder). Samme side sier at **GPU “per nå” ikke påvirker ytelsen** (men se GPU-varianter i NodeODM‑miljøet). citeturn18search1turn16search31  
ODM har også en “split-merge”-prosess for store datasett (“submodels”) som kan være praktisk ved store gårds-/jordbruksareal. citeturn16search12  

**MicMac** er tradisjonelt CPU-/pipeline-orientert; installasjonsoppskriften peker på verktøy som ImageMagick, ExifTool/Exiv2 og PROJ for å få komplett funksjonalitet, og den har tydelig “prerequisites”-liste. citeturn9view0  

**OTB** og **GRASS** er vanligvis mindre “RAM-sprengende” enn full fotogrammetri, men blir tunge ved store mosaikker/høy oppløsning; OTB har eksplisitt parameter for tilgjengelig RAM i enkelte apper. citeturn22search7turn22search3  

### Operativsystem og avhengigheter

- **ODM** anbefales kjørt i Docker på Windows/macOS/Linux. citeturn18search1turn18search11  
- **MicMac** bygges med Git/CMake/make og bruker bl.a. ImageMagick, ExifTool, Exiv2 og PROJ; finnes også Docker-image. citeturn9view0  
- **OTB** leverer “standalone package” med CLI-appene; for CLI-bruk brukes `otbcli_<AppNavn>` og miljøscript som `otbenv.bat`/`otbenv.ps1`. citeturn22search0turn22search5turn22search6turn22search2  
- **GDAL** leverer et stort sett CLI-verktøy (gdalbuildvrt, gdal_merge, gdal_translate osv.). citeturn12search32turn25search1  
- **PDAL** kjører mye via “pipeline JSON” og har `pdal pipeline`-kommandoen. citeturn13search0turn13search1  
- **ExifTool** og **Exiv2** er de facto standard valg i mange pipelines (MicMac nevner dem eksplisitt som metadata-verktøy). citeturn9view0turn3search0turn24search1  

---

## Lisens og praktiske implikasjoner

Lisensvalg påvirker særlig **(a) om du kan bygge en SaaS**, **(b) hvordan du kan redistribuere en “pakket løsning”**, og **(c) om endringer i koden må deles**.

**AGPLv3 (ODM)**: utformet for å sikre at modifisert kode blir tilgjengelig også når programmet brukes via nettverk; krav om å tilby kildekode til brukere som interagerer med den modifiserte versjonen over nettverk. citeturn23search0turn23search1turn16search6  

**GPL (Find‑GCP, GRASS; også CloudODM)**: sterk copyleft ved distribusjon av avledede verk; GPLv3 beskriver at distribusjon av modifisert verk skal lisensieres som helhet under GPLv3. citeturn23search4turn20search0turn14search6turn16search2  

**MPL 2.0 (openMVG, AliceVision/Meshroom, m.fl.)**: “file-level copyleft” – endringer i MPL-filer må deles, men det er lettere å kombinere med annen lisensiert kode enn GPL-familien. citeturn23search2turn21search7turn8search2  

**Apache 2.0 (OTB)**: permissiv lisens med eksplisitt patentlisens; OTB-dokumentasjon sier at du kan distribuere applikasjon basert på OTB under lisensen du velger, så lenge krav til kopi/attribution følges. citeturn23search3turn22search8turn22search0  

**MIT (GDAL)** og **BSD (PDAL, COLMAP)**: permissive lisenser som vanligvis er enkle å integrere i både åpen og proprietær programvare; GDAL-dokumentasjonen sier eksplisitt at GDAL/OGR er under MIT-lisens. citeturn25search0turn25search1turn25search3  

---

## Installasjon og bruks-eksempler i terminal

Eksemplene under er ment som “minimumskommandoer” for POC. I produksjon bør du alltid *logge parametre*, *versjoner* og *input-output manifest*.

### ODM (OpenDroneMap)

**Kjøring via Docker (typisk CLI‑pattern)**: ODM er dockerisert, og wiki-/Docker‑dokumentasjon viser eksempel der du binder inn `images/` og output‑mapper og kjører med parametre (f.eks. `--mesh-size`). citeturn18search11turn18search4  

```bash
# Eksempel: kjør ODM i Docker med volum-mounts
docker run -it --rm \
  -v "$(pwd)/images:/code/images" \
  -v "$(pwd)/odm_orthophoto:/code/odm_orthophoto" \
  -v "$(pwd)/odm_georeferencing:/code/odm_georeferencing" \
  opendronemap/odm --mesh-size 100000
```

**Prosjektstruktur med `--project-path`**: Dokumentasjonen beskriver at `--project-path` peker på en prosjektmappe som inneholder delmapper per datasett, og hver delmappe har en `images`‑mappe. citeturn18search9turn18search24  

```bash
# Eksempel: prosjekt-path-arbeidsflyt (strukturstyrt)
# /data/fieldrun/<dataset>/images/*.jpg
odm --project-path /data/fieldrun
```

**Multispektral og radiometrisk kalibrering (agro-relevant)**: ODM-argumentlisten inkluderer `radiometric-calibration` og `primary-band` til multispektral prosessering. citeturn18search24  

```bash
# Eksempel: multispektral prosessering (parametre må tilpasses sensor)
odm --project-path /data/fieldrun \
    --radiometric-calibration camera+sun \
    --primary-band auto
```

**Store datasett**: “split-merge” støttes for å dele store datasett i submodeller og deretter merge ortofoto/DEM/punktsky. citeturn16search12  

---

### MicMac (mm3d)

**Install (Ubuntu-eksempel fra prosjektets README):** citeturn9view0  

```bash
sudo apt-get install git cmake make ccache imagemagick \
  libimage-exiftool-perl exiv2 proj-bin libx11-dev

git clone https://github.com/micmacIGN/micmac.git
cd micmac && mkdir build && cd build
cmake ..
make install -j "$(nproc --all)"
```

**CLI-syntaks og help:** MicMac-wikien beskriver at alle kommandoer kan få inline help via `mm3d CommandName -help`. citeturn10search8  

```bash
mm3d Tapioca -help
mm3d Tapas -help
```

**Typisk “klassisk pipeline” (illustrativ):** mange MicMac‑pipeliner starter med tie-points (Tapioca), orientering (Tapas) og deretter DEM/ortho (Malt Ortho) og mosaikk (Tawny). Dette mønsteret er beskrevet i MicMac‑økosystemet og dokumentasjon/tutorials. citeturn10search8turn10search1  

```bash
# 1) Tie-points
mm3d Tapioca All ".*.JPG" 2500

# 2) Kameramodell/orientering (modellvalg avhenger av kamera)
mm3d Tapas RadialStd ".*.JPG" Out=Ori

# 3) DEM/ortho
mm3d Malt Ortho ".*.JPG" Ori DirMEC=MEC-Ori
```

---

### OTB (Orfeo ToolBox)

**Lisens og pakkeinnhold:** OTB distribueres åpent; fra OTB 6.0 brukes Apache 2.0, og standalone‑pakken inneholder CLI‑apper og bindings. citeturn22search0turn22search14  

**CLI-launchere:** OTB leverer scripts `otbcli_<ApplicationName>` som håndterer miljøvariabler. citeturn22search5turn22search9  

```bash
# Hjelp/tilgjengelige parametre
otbcli_BandMath -h
```

**NDVI med BandMath (direkte eksempel fra OTB-kursmateriale):** citeturn7view0  

```bash
# NDVI = (NIR - RED) / (NIR + RED)
# (eksempel der bånd 4 = NIR og bånd 1 = RED i datasettet)
otbcli_BandMath -il phr_xs_melbourne.tif \
  -out ndvi.tif float \
  -exp "(im1b4-im1b1)/(im1b4+im1b1)"
```

**Radiometriske indeks-apper:** OTB har applikasjonen *RadiometricIndices* for å beregne radiometriske indekser basert på relevante kanaler. citeturn22search3turn22search7  

```bash
# Generisk mønster – krever valg av indeks/kanaler iht. din sensor
otbcli_RadiometricIndices -in ortho_multiband.tif -out indices.tif
```

---

### GRASS GIS (CLI)

**NDVI med r.mapcalc:** GRASS‑manualen gir eksplisitt eksempel: `ndvi = 1.0 * (nir - red)/(nir + red)` og anbefaler `r.colors` for NDVI‑fargeskala. citeturn14search0turn14search32  

```bash
# NDVI i GRASS (forutsetter at rasterne nir og red eksisterer i mapset)
r.mapcalc "ndvi = 1.0 * (nir - red) / (nir + red)"
r.colors map=ndvi color=ndvi
```

**i.vi (vegetasjonsindekser):** i.vi beregner ulike vegetasjonsindekser og har NDVI som nøkkelord; synopsis viser CLI-parametre. citeturn14search1turn14search5  

```bash
i.vi viname=ndvi red=red nir=nir output=ndvi --overwrite
```

---

### GDAL (CLI)

**Bygge mosaikk uten å kopiere data først (VRT):** `gdalbuildvrt` bygger en VRT som mosaikk av flere raster. citeturn12search0turn12search20  

```bash
gdalbuildvrt mosaic.vrt tiles/*.tif
```

**Mosaikk til GeoTIFF:** `gdal_merge` mosaikkerer bilder (samme CRS, samme båndantall). citeturn12search2turn12search10  

```bash
gdal_merge.py -o mosaic.tif tiles/*.tif
```

**GeoTIFF georeferering (konsept):** GeoTIFF kan bære georeferering via tiepoint/pikselstørrelse, transformmatrise eller GCP‑liste. citeturn12search5  

---

### PDAL (CLI)

**Kjøre pipeline JSON:** `pdal pipeline` kjører pipeline‑definisjoner, med mulighet for “stream mode” der det er mulig. citeturn13search0turn13search33  

```bash
pdal pipeline pipeline.json
```

**Eksempelkommando fra PDAL tutorial:** `pdal translate input.las output.las --json pipeline.json` citeturn13search1  

```bash
pdal translate input.las output.las --json pipeline.json
```

**Raster fra punktsky:** `writers.gdal` lager raster fra punktsky ved interpolasjon (brukes typisk til DEM/DTM-lignende produkter). citeturn13search2turn13search6  

---

### Find‑GCP (agronomi: nøyaktige feltkart)

Find‑GCP har CLI‑verktøyet `gcp_find.py` og er eksplisitt dokumentert som “CLI only” for å lage GCP‑fil (med eksempelkommandoer). citeturn19view0turn20search0  

```bash
# Install (Python-avhengigheter)
pip install opencv-python opencv-contrib-python PIL pil.imagetk numpy matplotlib

# Eksempel: generere ODM-kompatibel gcp_list.txt fra ArUco-markører
./gcp_find.py -v -t ODM -i samples/A3.txt --epsg 23700 \
  -o gcp_list.txt --minrate 0.01 --ignore 0.33 \
  -d 99 samples/DJI_017[234].JPG
```

---

### ExifTool og Exiv2 (metadata/QC)

**ExifTool**: kan lese/ skrive metadata (og er mye brukt i etterforskning/QA-sammenheng). citeturn2search3turn3search4turn3search0  

```bash
# Eksempel: trekk ut GPS og tidspunkt til CSV for QA
exiftool -csv -r \
  -GPSLatitude -GPSLongitude -GPSAltitude \
  -DateTimeOriginal -Make -Model \
  images/ > exif_qc.csv
```

**Exiv2**: prosjektet beskriver Exiv2 som bibliotek + CLI for å lese/ skrive/ slette Exif/IPTC/XMP/ICC. “Command line utility examples” viser `-pt` og `-pv`. citeturn24search1turn24search5turn24search6  

```bash
# Tolket (translated) EXIF-output
exiv2 -pt IMG_0001.jpg

# “Plain values” output
exiv2 -pv IMG_0001.jpg
```

---

## Foreslått landbruks-orientert CLI-arbeidsflyt

Denne arbeidsflyten er designet for å være reproduserbar og “scriptbar”, med tydelig skille mellom geometri (fotogrammetri), radiometri (indekser) og QA (metadata + nøyaktighet).

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["drone orthomosaic agriculture field", "NDVI map farmland", "drone point cloud crop field", "digital surface model DSM agriculture"],"num_per_query":1}

**Stegvis pipeline (konsept):**
1. **Inntak og QA av råbilder**
   - Kjør ExifTool/Exiv2 for å sjekke at bildene faktisk har (a) GPS, (b) timestamp, (c) ensartet kameramodell/båndstruktur før prosessering. citeturn3search4turn24search6  
2. **Fotogrammetri til ortomosaikk + DSM/DTM**
   - Kjør ODM (Docker) eller MicMac for å produsere georeferert ortomosaikk og høydeprodukter. citeturn18search6turn18search1turn9view0  
3. **Valgfritt: GCP-basert nøyaktighetsløft**
   - Bruk Find‑GCP (ArUco) for automatisk å bygge GCP‑fil og kjør ODM med GCP i prosessen (eller tilsvarende i MicMac). citeturn19view0turn18search20  
4. **Radiometriske produktyttere**
   - Beregn NDVI (og eventuelt andre indekser) fra multispektral ortomosaikk med OTB (BandMath eller RadiometricIndices) eller GRASS (r.mapcalc/i.vi). citeturn7view0turn22search3turn14search0turn14search1  
5. **Deriverte agronomiske kart**
   - “Canopy height proxy” (om du har både DSM og DTM): typisk rasteralgebra `CHM = DSM - DTM` i GRASS eller via GDAL-rasterkalkulasjon (praktisk: hold alt i GeoTIFF/VRT). (Formelen er enkel rasteralgebra; datagrunnlaget kommer fra ODM/MicMac.) citeturn18search14turn14search0turn12search0  
6. **Eksport og pakking**
   - Standardiser outputs (GeoTIFF for raster, LAS/LAZ/PLY for punktsky) og bygg VRT/mosaikker ved behov med GDAL. citeturn12search0turn12search2turn13search31turn13search2  

---

## Testdata og validering i landbrukskontekst

### Testdata å starte med

- **ODMData**: OpenDroneMap tilbyr en katalog av eksempel-datasett for ODM/WebODM og relaterte prosjekter, med “kjent suksess”-markeringer. Dette er godt egnet for en 2‑ukers POC fordi du får reproduserbare testinputs. citeturn16search0  
- **ODM Benchmarks**: finnes for å benchmarke datasettene og forstå “behavioral characteristics” av ODM; nyttig når du skal sammenligne maskinvare/parametre. citeturn16search16turn16search18  

### Valideringsmetoder og kvalitetsmål

**GSD (Ground Sampling Distance):** praktisk mål på romlig oppløsning (cm/pixel) og direkte relevant for hvor små felt-/plantefenomener du faktisk kan måle. Ulike kilder gir standardformler basert på flyhøyde, sensorbredde og bildepiksler. citeturn17search20turn17search28  

**Kontrollpunkter vs sjekkpunkter:** kontrollpunkter (GCP) brukes til å forbedre modellen under prosessering, mens sjekkpunkter brukes til å evaluere nøyaktighet *etterpå* og må være uavhengige. citeturn17search33turn17search1  

**RMSE og rapportering:** ASPRS-standarden er en mye brukt referanse for hvordan posisjonell nøyaktighet uttrykkes med RMSE-klasser/terskler. citeturn17search2turn17search34  

**Norsk/Skandinavisk rammeverk og referanseprodukter:**  
- Kartverket beskriver ortofoto som georefererte flybilder som stemmer med kartet (Norge i bilder), og at sluttproduktet er “ortofoto”. citeturn17search19  
- Datasettbeskrivelse i data.norge.no understreker at ortofoto har kartgeometri og kan knyttes til referansesystem, men at oppløsning/nøyaktighet varierer. citeturn17search23  
- For generelle begreper om geodatakvalitet (nøyaktighetsbegreper) finnes en norsk standard (SOSI/Geonorge). citeturn17search3  

---

## Anbefaling og 2‑ukers test‑POC

### Anbefalt “først å prøve”-pakke

**Pakke A: rask landbruks-POC (mest praktisk)**
- ODM (fotogrammetri) + OTB (indekser) + ExifTool (QA)  
Begrunnelse: ODM gir georefererte basisprodukter (ortho/DEM/punktsky) fra dronebilder i CLI-form. citeturn18search6turn18search14  
OTB gir robust CLI for NDVI og andre radiometriske indekser som er direkte relevant for plantehelse/vegetasjonsstatus. citeturn7view0turn22search3turn22search5  
ExifTool gjør det lett å QA’e og logge data før tunge kjøringer. citeturn2search3turn3search4  

**Pakke B: nøyaktighetsløft**
- Legg til Find‑GCP hvis du vil bruke ArUco‑markører og automatisere GCP‑filer. citeturn19view0turn20search0  

**Pakke C: ekspertfotogrammetri**
- MicMac som alternativ/benchmark mot ODM når du trenger ekstrem kontroll og er villig til å investere mer i parameterstyring og pipeline-kompleksitet. citeturn9view0turn10search12turn10search8  

### Ikke anbefalt som “første landbruks-POC”

Den GitHub-lenken du nevnte (**Automated Drone Image Analysis Tool – ADIAT**) er eksplisitt laget for “Search and Rescue” og fokuserer på fargedeteksjon gjennom OpenCV og Qt-basert UI, ikke på ortomosaikk/DEM/NDVI som typisk er kjernen i landbrukskartlegging. citeturn15view0  
Den kan likevel være interessant hvis du vil bygge en egen “anomaly/ROI detector”, men den er ikke en direkte erstatning for fotogrammetri + indeksberegning.

### Mermaid-tidslinje for 2‑ukers POC

```mermaid
gantt
    title 2-ukers POC: CLI-basert landbruksanalyse av dronebilder
    dateFormat  YYYY-MM-DD
    axisFormat  %d.%m

    section Oppstart og datastruktur
    Velg testdatasett (ODMData) + etablere mappekonvensjon :a1, 2026-02-18, 1d
    Metadata-QA med ExifTool/Exiv2 + loggmal           :a2, after a1, 1d

    section Fotogrammetri
    ODM-kjøring baseline (standardparametre)           :b1, 2026-02-20, 2d
    Eksporter ortho + DSM/DTM + punktsky               :b2, after b1, 1d

    section Nøyaktighet (valgfritt men anbefalt)
    Planlegg GCP/check points + kjør Find-GCP         :c1, 2026-02-24, 2d
    ODM-kjøring med GCP + sammenlign mot baseline      :c2, after c1, 1d

    section Agro-analyse
    NDVI/indekser med OTB (BandMath/RadiometricIndices):d1, 2026-02-27, 2d
    Avledede kart (CHM, terskling, maskering)          :d2, after d1, 1d

    section Validering og rapport
    Kvalitetsmål: GSD, RMSE (hvis GCP/check points)    :e1, 2026-03-02, 2d
    Pakk output + reproduserbar kjørelogg              :e2, after e1, 1d
```

---

## Prioriterte kilder å bruke videre

Følgende kilder bør brukes som “primærkilder” når du går fra POC til robust workflow og dokumentasjon:

- **OpenDroneMap/ODM**: offisiell dokumentasjon (installasjon, argumenter, large datasets, multispektralparametre) og GitHub-repo. citeturn18search1turn18search24turn16search12turn18search6  
- **ODMData + ODM Benchmarks** for testdata og reproduserbare sammenligninger. citeturn16search0turn16search16turn16search18  
- **OTB Cookbook** (CLI interface, BandMath, RadiometricIndices, install) + OTB lisens/FAQ. citeturn22search5turn22search1turn22search3turn22search0turn22search8  
- **GRASS GIS manual** (imageryintro/r.mapcalc/i.vi) for indekser og rasteralgebra. citeturn14search0turn14search1turn14search32  
- **GDAL docs** (gdalbuildvrt/gdal_merge/GeoTIFF driver/licens) for mosaikk, reprojeksjon og output-standardisering. citeturn12search0turn12search2turn12search5turn25search0  
- **PDAL docs** (pdal pipeline, writers.gdal) for punktsky og DEM/DTM-avledninger. citeturn13search0turn13search2turn25search3  
- **Find‑GCP** (CLI-usage, parametre, outputformater) for GCP-automatisering. citeturn19view0turn20search0  
- **Norsk referanse**: Kartverket/Geonorge for definisjoner rundt ortofoto og geodatakvalitet, samt datasettbeskrivelser. citeturn17search19turn17search23turn17search3  
- **Standarder for nøyaktighet**: ASPRS posisjonell nøyaktighetsstandard (RMSE & rapportering) og FGDC-materiale for GCP vs checkpoints. citeturn17search2turn17search33  

