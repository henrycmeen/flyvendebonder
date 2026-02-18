# FVB-006 – Oppdrag- og bilde-metadata (GSD/overlapp/EXIF QC)

## Status
Pågår (operativt grunnlag mot beslutningsflyt er nå på plass i UI/backend, siste rapportering er planlagt).

## Problem
Vi trenger en robust pipeline for å tolke flybilder og hente ut kvalitetssignaler før de sendes inn i kart- og AI-workflows.

## Mål
- Beregne GSD og bildeavtrykk per bilde.
- Beregne og lagre overlappparametre.
- Markere når metadata er usikker (særlig uten kompass/IMU).
- Gjøre dataene klare for senere AI-klassifisering i Spor B.

## Datagrunnlag
- EXIF fra kamera: `FocalLength`, `FocalLengthIn35mmFormat`, `GPS*`, `FNumber`.
- Bildestørrelse (px), eventuelt kamera-/sensorprofiler.
- Terrenghøyde for AGL (GPS-alt - terreng).
- IMU/kompass: yaw/pitch/roll når tilgjengelig.

## Utregninger
1. Nadir:
   `GSD ≈ (H × p) / f`
2. Alternativ når fysisk piksel ikke er kjent:
   `GSD = (H × sensor_bredde_mm) / (f_mm × bildebredde_px)`
3. Oblique:
   `GSD = (R_s × p) / (f × cos θ)`
4. Bildeavtrykk:
   `ImageFootprintWidth = bildebredde_px × GSD`
5. Track spacing:
   `TrackSpacing = ImageFootprintWidth × (1 − sidelap)`

## Felter i lagring/API
- `gsd_m`
- `image_footprint_w_m`
- `track_spacing_m`
- `overlap_front`
- `overlap_side`
- `oblique_correction_applied` (bool)
- `needs_manual_qc` (bool)
- `quality_notes` (tekstfelt)

## Leveranse
- Metadata skrives ved import til database/API.
- Mangler IMU/kompass => `needs_manual_qc = true`.
- Viser enkel visning i UI med:
  - GSD
  - fotavtrykk
  - overlappparametre
  - QC-status
- Gjør feltene tilgjengelige for Spor B (crop label confidence og QC-filtrering).

## Gjennomført nå
- Backend:
  - `derive_ground_sampling(...)` beregner `gsd_m`, `image_footprint_w_m`, `track_spacing_m`, `overlap_front`, `overlap_side`, `oblique_correction_applied`.
  - `needs_manual_qc` kan nå skrus av/på via `/api/v1/photos/{id}/metadata`.
  - Feltene returneres i `PhotoFeature` og brukes i filtre.
  - Ny alembic-migrasjon lagt til: `20260218_05_photo_fvb006_metadata_fields.py`.
  - AR5/jordsmonn-oppslag gjør nå kontrollert fallback når estimert punkt ser ut som å treffe ikke-jord; da brukes droneposisjon som alternativ hvis den gir bedre jordbrukskontekst.
- UI:
  - Fullskjermkortet viser metadatafeltene (GSD, avtrykk, overlap, oblique-korreksjon, analyse-sone).
  - Fullskjermkortet lar bruker sette/lagre `needs_manual_qc` manuelt.

## Gjenstående
- Legge på serievis visuell rapport for overlappsprofil (valgfrie parametre i et dedikert kontrollpanel).

## Akseptanse
- Importert bilde har alle ovennevnte felt når mulig.
- Manglende inputfelt settes tydelig som usikkerhet i stedet for nulling uten forklaring.
- En bruker kan i UI sette `needs_manual_qc` til `ok` etter gjennomgang.
- JSON/CSV-export av beregningsrapport per serie kan lages.

## Bruk i Spor B
- Kun bilder med QC-status OK brukes som “sikre” treningsdata.
- `needs_manual_qc` brukes i UI for å filtrere usikre felt/område.
