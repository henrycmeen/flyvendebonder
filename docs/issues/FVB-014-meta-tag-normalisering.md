# FVB-014 – Metadata-normalisering for heading/pitch og yaw-konvensjoner

## Målet
Standardisere hvordan vi tolker drone-eksif før videre beregning av view-line og QC, uten å endre hovedarkitekturen.

## Område
Kvalitetsgrunnlag (FVB-006/009/011).

## Status
På gang (design- og implementasjonsforberedelse).

## Inspirasjon
- [florian-senn/dji-XMetaParser](https://github.com/florian-senn/dji-XMetaParser) (MIT): tydelig parsing av DJI XMP-flows.
- [mapillary/OpenSfM exif.py](https://raw.githubusercontent.com/mapillary/OpenSfM/main/opensfm/exif.py) (BSD-2-Clause): feltmapping og konvensjonshåndtering (f.eks. `FlightYawDegree`, `GimbalPitchDegree`).
- [OpenDroneMap/ODM Issue #1809](https://github.com/OpenDroneMap/ODM/issues/1809): kjent FlightYaw vs GimbalYaw-felle for retning.

## Oppdaget i koden vår i dag
- `apps/backend-api/app/services/imports.py` bruker allerede énkelt prioritering:
  - heading: `flight_yaw -> gimbal_yaw -> camera_yaw -> compass -> heading`
  - pitch: `gimbal -> flight -> camera`
- `apps/backend-api/app/services/metadata_utils.py` støtter mange alias, men har ikke eksplisitt normalisering for pitch-retning (sign) eller tydelig konfliktmarkering når flere kilder gir motstrid.
- `needs_manual_qc` settes kun via manglende felter, ikke via usikkerhet i feltkilde-kvalitet.

## Forslag (inspirasjonsdrevet)
- Bygg en liten normaliseringsmodul mellom raw metadata og valgt heading/pitch:
  1. Parse og lagre feltkilde (`heading_candidate`, `pitch_candidate`, `height_source`) med usikkerhet.
  2. Legg inn eksplisitte pitch-konverteringer når kildene bruker ulike konvensjoner (f.eks. tegnretning).
  3. Legg QC-annotasjon ved kildesprang (f.eks. `qc:heading_source_switch`, `qc:pitch_sign_uncertain`).
  4. Forlenget `meta:heading_source`/`meta:pitch_source` med årsak/fallback i stedet for bare nøkkelord.

## Akseptanse
- `heading_source` og `pitch_source` lagres med mer presis årsaksgrad (ikke bare `imu/gps_course/...`).
- Metadatafelt med høy konflikt mellom kilder merkes til manuell kontroll.
- Konsekvensen kan måles i lavere antall feil som følger av feil yaw/pitch-konvertering i analyse.
- Eksisterende import-flate og UI-felter fortsetter å fungere (bakoverkompatibelt), bare med riktigere scoring og begrunnelser.
