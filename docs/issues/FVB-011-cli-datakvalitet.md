# FVB-011 – CLI-støtte for metadatakvalitet

## Målet
Ha en lettvekts CLI-linje for å sjekke datakvalitet før modell- og analysearbeid.

## Område
Verktøykjede / datakvalitet.

## Gjeldende status
Pågår.

## Leveranse
- Nytt script for metadata-rapport fra bildekatalog (`scripts/photo_qc_report.py`):
  - rapport i JSON + lesbar konsolloppsummering
  - `needs_manual_qc`, `heading_source`, `pitch_source`, `confidence_score`, `location_uncertainty_m`, `analysis_zone`.
  - topp-lister for manglende heading/pitch/GPS/eksiftd-data
- Dokumentert bruk med path + flagg (`--source`, `--output`, `--max-files`, `--min-confidence`, `--csv`, `--pretty`).
- Rapportfelt skal kunne brukes til å trigge manuell QC i web-app.

## Målbildet før ML
Dette brukes som stabiliseringslag før modellbygging: kun kvalitetskvalifiserte bilder går videre til manuell og senere automatisk evaluering.

## Akseptanse
- Scriptet kjører på en mappe med bilder med realistisk metadata.
- Minst to eksportformater: JSON rapport og standard konsolloppsummering.
- Feil på enkelte filer bryter ikke hele kjøringen; feil listes i rapporten.
- Dokumentasjon i README eller docs peker til scriptet med 1-2 praktiske eksempler.

## Neste arbeid
1. Koble resultatet til et enkelt statusfilter i UI (`needs_manual_qc == true`).
2. Legg inn optional CSV-export.
3. Vurder å legge QC-rapporten i `docs/drift` for ukentlig sjekk.

## Statusoppdatering
- CLI-kjernelinjen fra `scripts/photo_qc_report.py` og `scripts/cycle-metadata-qc.sh` er operasjonell i repoet og rapporterer `heading_source`, `pitch_source`, `confidence_score`, `needs_manual_qc` og `analysis_zone`.
- Neste punkt er å vise resultatene i UI med ett filter (`needs_manual_qc`) før Spor B.
