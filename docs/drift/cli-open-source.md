# CLI-open-source pipeline (kvalitetseksperiment)

Denne kjeden brukes som kvalitetseksperiment og støtte for kjernearbeidet (geometri + usikkerhet), ikke som standardproduktforutsetning.
Hensikten er å gi en enkel, repeterbar kjede for kvalitetssjekk av bildedata før man velger videre AI/NDVI-forsøk.

## 1) Første kjøring (lokalt)

```bash
./scripts/cycle-metadata-qc.sh \
  "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  .metadata-qc-runs \
  0
```

Argumentene betyr:

- `1`: kilde-mappe med bilder
- `2`: output-mappe (default `.metadata-qc-runs`)
- `3`: maks antall filer (0 = alle)

Kjører i samme pass:

1. `exiftool` eksport (hvis installert)
2. `scripts/extract_photo_metadata.py`
3. `scripts/photo_qc_report.py` med:
   - `--min-confidence 0.72`
   - JSON + CSV output
4. `manifest.json` som knytter alle output-filer til runen

## 2) Output-struktur

- `.metadata-qc-runs/<timestamp>/photo_qc_report.json`
- `.metadata-qc-runs/<timestamp>/photo_qc_report.csv`
- `.metadata-qc-runs/<timestamp>/photo_metadata_report.json`
- `.metadata-qc-runs/<timestamp>/exif_summary.csv` (kun hvis `exiftool` finnes)
- `.metadata-qc-runs/<timestamp>/manifest.json`

## 3) Neste steg etter denne kjeden

- Filtrere i UI på `needs_manual_qc`
- Sette opp egen "acceptance"-regel per mappe / sesong
- Bruke resultatene der de faktisk forbedrer FVB-006/009/010-kvaliteten; ellers står dette som valgfri utforskning.
- Legge til valgfri `gdal`-/`otb`-fase når multispektral pipeline er klar

## 4) Nyttige grep ved feil

- `--help` i hvert script for parametre
- Sjekk at bilder har gyldige GPS/heading/pitch før punktgeometri brukes
- Kjør med `MAX_FILES` lavt (`3` eller `5`) for rask test

Eksempel:

```bash
./scripts/cycle-metadata-qc.sh \
  "/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder" \
  .metadata-qc-runs \
  3
```
