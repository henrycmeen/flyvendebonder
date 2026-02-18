# Issues – Flyvendebønder

## Hvordan bruke denne mappen
Bruk denne mappen som ett enkelt backlog-område. Én fil kan representere en større issue, eller vi kan holde løpende saker i én liste.

## Sentrale områder
1. Kart og rendering
2. Tidslinje/filtrering
3. Bilde-import og deduplisering
4. Eiendomsdata og NIBIO-jobb
5. Ytelse og stabilitet
6. UI/UX og designfinpuss
7. Drift og logging
8. Produktretning og leveransesekvenser

## Aktive issues

### FVB-013 – Produktvei: tolkingsmotor først (ikke full ortofoto-stack)
- **Status:** Pågår
- **Område:** Produktretning
- **Beskrivelse:** Fastslå og operasjonalisere at Flyvendebønder leverer et tolkingsmotor-spor med prioritet på geometri, treffpunkt, usikkerhet og agronomisk kontekst.
- **Akseptansekriterium:**
  - Backlogen har tydelig prioritert FVB-006/009/010 før spor B/klient-agnostisk AI- og orthoarbeid.
  - CLI-oppgaver er merket som sideeksperiment med tydelig avgrensning.
  - Neste sprint har konkrete leveranser for punktkvalitet, usikkerhet og footprint/sampling.

### FVB-001 – Stabilitet i kartrenderer ved raske re-renders
- **Status:** Open
- **Område:** Kart og rendering
- **Beskrivelse:** Sørge for at kartcontainer blir korrekt oppryddet/rerender ved view-endringer uten at Leaflet bryter.
- **Akseptansekriterium:** Ny sidebytte/refresh gir ikke blank side; kart forblir renderbart under feil i WMS.

### FVB-002 – Timeline-arkitektur for sesong/år
- **Status:** Open
- **Område:** Tidslinje/filtrering
- **Beskrivelse:** Gjøre år- og sesongvalg mer eksplisitt, med tydelig visning av valgt år/måned.
- **Akseptansekriterium:** Brukeren kan raskt se hva som er aktivt filter og bytte uten at data forsvinner.

### FVB-003 – Performance med større bildekatalog
- **Status:** Open
- **Område:** Ytelse
- **Beskrivelse:** Gjennomgå lazy-loading, cluster-ytelse og dataload ved tusenvis av punkter.
- **Akseptansekriterium:** Sjekk på realistisk datasettsstørrelse skal ligge under akseptable terskler.

### FVB-004 – Eiendomsgrense-status ved feilkode 100
- **Status:** Open
- **Område:** Eiendomsdata / WMS
- **Beskrivelse:** Forbedre håndtering av NIBIO-feilkoder (kode 100) med tydeligere brukerfeedback og fallback.
- **Akseptansekriterium:** Bruker får klar melding om status, og kartlaget oppfører seg deterministisk ved feil.

### FVB-005 – Designtoken for nye markører
- **Status:** Open
- **Område:** UI/UX
- **Beskrivelse:** Støtte tydeligere ikoner (drone vs kamera) og justere pop-up-størrelse/posisjon.
- **Akseptansekriterium:** Markerinteraksjon er tydelig på desktop og mobil.

### FVB-006 – Oppdrag- og bilde-metadata (GSD/overlapp/EXIF QC)
- **Status:** Pågår (operativ beslutningsflyt)
- **Område:** Bilde-import og datamodell
- **Beskrivelse:** Etablere en robust pipeline for å parse EXIF, beregne per-bilde GSD og fotavtrykk, lagre overlapplogikk, og flagge behov for manuell kvalitetssikring (særlig ved manglende kompass/IMU).
- **Akseptansekriterium:**
  - Import av bilder skriver metadatafelt til API/DB: `gsd_m`, `image_footprint_w_m`, `track_spacing_m`, `overlap_front`, `overlap_side`, `oblique_correction_applied`, `needs_manual_qc`.
  - GSD beregnes med standard-formel og oblique-formel når pitch/roll/yaw/kompass er tilgjengelig.
  - QC-tilstander rapporteres per bilde med `needs_manual_qc`, `confidence_score`, `confidence_reason`.
  - Heading-pålitelighet lagres som `heading_source` (`imu`, `gps_course`, `inferred_from_sequence`, `unknown`).
  - En enkel visuell oversikt viser hvilken overlapplogikk og AGL-antagelse som er brukt for serien.
  - Metadatafelt kan brukes av senere kart-/AI-workflows (f.eks. Spor B) som datakvalitetssignaler.

### FVB-007 – Planleggingsstøtte for GSD og flyruteparametre
- **Status:** Open
- **Område:** Drift og kvalitet
- **Beskrivelse:** Legge til et lite planleggingsverktøy som foreslår front-/sidelap og sporavstand gitt ønsket GSD-mål og kamera/utsnitt.
- **Akseptansekriterium:**
  - Bruker kan lese inn kamera-parametre eller velge kameraprofil og få beregnet forslag for `track_spacing_m`.
  - Verktøyet foreslår praktiske utløser- og overlappsverdier i lesbart format.
  - Rapport om beregnet profil kan eksporteres i JSON per serie.

### Neste prioriterte spor
- **1:** FVB-014 (Metadata-normalisering) – reduserer grunnfeil i geometri/QC.
- **2:** FVB-016 (Overlapp- og footprint-kvalitet) – gir praktisk overlapplogikk og QC-signal.
- **3:** FVB-007 (Planleggingsstøtte) – brukes når metrikker er bedre stabilisert.

### FVB-014 – Metadata-normalisering for heading/pitch og yaw-konvensjoner
- **Status:** På gang (inspirasjonsdrevet forberedelse)
- **Område:** Metadata/QC og geometri
- **Beskrivelse:** Standardisere tolkning av DJI/XMP-heading- og pitch-felt, inkludert konflikt-håndtering mellom kilder og tydeligere `heading_source`/`pitch_source`.
- **Akseptansekriterium:**
  - Metadatafelter bevarer bakoverkompatibilitet, men lagrer forsterket begrunnelse for valgt kilde (`candidate`, konfliktstatus, fallback-grunn).
  - Kildesprang (f.eks. FlightYaw vs GimbalYaw) registreres som QC-annotasjon med høyere manuell prioritet.
  - Pitch-konvensjoner (tegn/offset) standardiseres på tvers av kameramodeller uten å endre brukerflyt.
- **Inspirasjon:** `dji-XMetaParser`, `OpenSfM exif.py`, `ODM #1809`.
- **Lenke:** `docs/issues/FVB-014-meta-tag-normalisering.md`

### FVB-015 – DEM-basert view-line og “kamera ser”-robusthet
- **Status:** På gang (inspirasjonsdrevet forberedelse)
- **Område:** Geometri og usikkerhet
- **Beskrivelse:** Legge inn et DEM-basert ray-casting-lag som forbedrer “kamera ser”-beregningen, med eksisterende flat-jord-modell som kontroll/tilbakefall.
- **Akseptansekriterium:**
  - API merker om geometrien er beregnet med flat-jord eller DEM-basert metode per bilde.
  - DEM-beregning brukes når DEM-kilde og kvalitet finnes, og nedgraderer trust-score ved store avvik.
  - Eksisterende `view_lat`, `view_lng`, `location_uncertainty_m` forblir kompatible.
- **Inspirasjon:** `OpenAthena-Legacy-Python`, `photogeoref`, `luipir image footprint`.
- **Lenke:** `docs/issues/FVB-015-ray-geometri-med-dem.md`

### FVB-016 – Overlapp- og footprint-kvalitet (planlagt vs faktisk)
- **Status:** På gang (inspirasjonsdrevet forberedelse)
- **Område:** Metadata/QC og geometri
- **Beskrivelse:** Gjøre overlapplogikk operativ ved å skille planlagt overlap fra målt overlap med rotert footprint og nabolagsanalyse.
- **Akseptansekriterium:**
  - Track/footprint brukes med rotasjon fra heading i tillegg til radius-beregning.
  - `overlap_actual_front/side` og `coverage_profile` kommer inn i rapport/UI som et QC-signal.
  - Store avvik mellom planlagt og faktisk overlap flagges uten å stoppe import.
- **Inspirasjon:** `mikoontz/neon-drone-workflow`, `luipir image footprint`, `Drone-Footprints`.
- **Lenke:** `docs/issues/FVB-016-overlapp-og-fotopunkt-rotasjon.md`

### FVB-017 – Jordsmonn som kartlag (overlay/heatmap)
- **Status:** Open
- **Område:** UI/UX og visualisering
- **Beskrivelse:** Legge til et valgfritt jordsmonn-lag i kartvisning (WMS-overlay) som rask visuell tolkning av AR5-jordsmonn, i tillegg til punktvis tekstvisning.
- **Akseptansekriterium:**
  - Toggle for jordsmonn kan skrus av/på i kart.
  - Overlay vises med kontrollert opasitet og egen lagrekkefølge.
  - Feil/timeout på WMS vises tydelig i UI-status.
  - Lagen kan utvides til heatmap senere uten å bryte dagens metadataflyt.
- **Inspirasjon:** Eksisterende NIBIO WMS/WFS-kilder i `apps/backend-api/app/config.py`.
- **Lenke:** `docs/issues/FVB-017-jordsmonn-kartlag-heatmap.md`

### FVB-008 – Spor B grunnlag (AI for åkertyper, MVP)
- **Status:** On hold (venter på stabil grunnlag)
- **Område:** AI og avlings-etiketter
- **Beskrivelse:** Bruke metadatafeltene som grunnlag for en MVP-klassifiseringstråd for felt (eng/gras, korn, brakk, skog/ikke-åker), med tydelig godkjenningsflyt.
- **Notat:** Flyttes fra aktiv AI-iterasjon inntil FVB-006/009/010/011 er stabile og kvalitetssikret.
- **Akseptansekriterium:**
  - Feltresultater lagres med `crop_type`, `confidence`, `source`, `version`, `status`.
  - UI viser feltpolygoner med godkjenn/endre-flyt.
  - Brukerens godkjenningsvalg lagres som “gold layer” for neste iterasjon.

### FVB-009 – Geometrisk presisjon og usikkerhet (fase 1)
- **Status:** Pågår (kjernepunkter operative)
- **Område:** Geometri
- **Beskrivelse:** Gjøre geometri- og synspunktberegninger robust med eksplisitte usikkerhetsmål.
- **Akseptansekriterium:**
  - Hvert bilde får `heading_source` og `pitch_source`.
  - Hvert bilde får `confidence_score` og `confidence_reasons` før AI-bruk.
  - Hvert bilde får `location_uncertainty_m`.
  - Frontend viser usikkerhet som visuell indikator på kart.

### FVB-010 – Footprint og 5-punkts zone
- **Status:** Pågår (operativt i appen)
- **Område:** Geometri
- **Beskrivelse:** Formalisere analyse-område i datafelt: sentralt punkt, footprint/zone og samplepunkter.
- **Akseptansekriterium:**
  - API-svar inneholder `analysis_zone` med punktsett og usikkerhetsradius.
  - Konfigurerbar sample-strategi (`cross_5`) lagres på serie/nivå.
  - Kart viser footprint + samplepunkter for manuell validering.
  - Lav tillit-filtrering brukes nå operativt i kart og album.

### FVB-012 – CLI-støtte med åpne verktøy (uten ny ML)
- **Status:** På vent (sideeksperiment)
- **Område:** Verktøykjede
- **Beskrivelse:** Etablere en reproducible CLI-kjede med kun åpne verktøy for kvalitet og geometri, før ML-modeller blir vurdert.
- **Neste leveranse nå:** Kjørbar `scripts/cycle-metadata-qc.sh` + drift-notat i `docs/drift/cli-open-source.md`.
- **Akseptansekriterium:**
  - Klar pipeline-definisjon for metadata-QC og fotovisuell/geom. validering.
  - Rapportformat (`json`, `csv`) med `heading_source`, `confidence_score`, `needs_manual_qc`, `analysis_zone`.
  - Valgfritt steg for ortofoto/indekser med åpne verktøy (ODM/OTB/GDAL) dokumentert i egne oppgaver.
  - Skript-feil håndteres som egne poster i rapporten (ingen hard-krasj av hele køen).
  - CLI-aktiviteter må kun kjøres når de gir direkte verdi for FVB-006/009/010 (ikke som default for hver leveranse).

### FVB-011 – CLI-støtte for datagrunnlag
- **Status:** Pågår
- **Område:** Verktøykjede
- **Beskrivelse:** Lage terminalbaserte steg for metadatakvalitet, geometrivalidering og (senere) åpne AI-komponenter uten ny modelltrening.
- **Akseptansekriterium:**
  - Dokumentert CLI-workflow for ExifTool/Exif-rapportering på mappe.
  - CLI-script for fotomengdevalidering mot GSD/heading/pitch-regler.
  - CLI-script for feltanalysekandidat (forhåndsvurdering) uten modelltrening.
  - Scriptnavn, flags og kjøreeksempel står i README.

## Nye issues
- Legg ny issue her med formatet `FVB-###`, kort beskrivelse, status og akseptansekriterium.
- Flytt ferdige saker til `docs/issues/finished/` når de er lukket.
