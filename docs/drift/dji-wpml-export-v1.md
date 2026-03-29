# DJI WPML-eksport v1

## Formål
Flyvendebønder eksporterer nå ekte DJI-waylines som `KMZ` med `WPML` for støttede DJI-profiler. Dette er første versjon av en eksport som er ment å kunne importeres i DJI sitt wayline-oppsett, i stedet for bare å gi en generell GeoJSON-bundle.

## Formater
- `auto`
  - prøver først å bygge enterprise `DJI KMZ`
  - prøver deretter `DJI Fly KMZ` for støttede forbrukerprofiler
  - faller til slutt tilbake til generell bundle
- `dji-wpml`
  - krever støttet DJI-profil
  - returnerer `400` hvis profilen ikke støttes
- `dji-fly`
  - krever støttet `DJI Fly`-profil
  - returnerer `400` hvis profilen ikke støttes
- `bundle`
  - tvinger gammel generell eksport

## Innhold i DJI-eksporten
Flyvendebønder bygger en `KMZ` med:
- `wpmz/template.kml`
- `wpmz/waylines.wpml`

Ruten blir serialisert som waypoint-basert mission med:
- mission config
- drone/payload-info
- waypointer i rekkefølge
- `takePhoto`-actions på capture-punkter

## Støttede profiler i v1
- `dji-mavic-3-enterprise`
- `dji-matrice-30t`

## Ikke støttet i enterprise WPML-sporet
- `dji-mini-4-pro` bruker eget `DJI Fly`-spor, se `dji-fly-mini4pro-export-v1.md`
- andre DJI-profiler som ikke er mappet til DJI sine offisielle WPML-enumverdier

Disse får:
- `DJI Fly KMZ` ved `format=auto` hvis profilen støttes der
- ellers `bundle` ved `format=auto`
- `400` ved `format=dji-wpml`

## Begrensninger
- eksporten er bygget fra Flyvendebønder sin rutegeometri, ikke fra DJI Pilot 2
- vi har strukturelle tester for `KMZ/WPML`, men ikke bekreftet import i DJI Pilot 2 i denne versjonen
- høyde, hastighet og fotohandlinger er mappet konservativt for å gi en trygg første eksportprofil
- `Mini`-serien er ikke falskt støttet

## Neste steg
- test faktisk import i DJI Pilot 2
- verifiser waypoint heading/turning i en ekte enhet eller emulator
- vurder flere enterprise-profiler dersom vi trenger dem
- avgjør om frontend skal eksponere et eksplisitt valg mellom `DJI KMZ` og `generell bundle`

## Kilder
- DJI Cloud API Docs – `WPML`
- DJI Cloud API Docs – `template.kml`
- DJI Cloud API Docs – `waylines.wpml`
