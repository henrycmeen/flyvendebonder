#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="${1:-/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder}"
RUN_DIR="${2:-$ROOT_DIR/.metadata-qc-runs}"
MAX_FILES="${3:-0}"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Fant ikke bildemappen: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$RUN_DIR"

TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
TARGET_DIR="$RUN_DIR/$TIMESTAMP"
mkdir -p "$TARGET_DIR"

LOG_FILE="$TARGET_DIR/run.log"
PHOTOS_REPORT="$TARGET_DIR/photo_qc_report.json"
PHOTOS_REPORT_CSV="$TARGET_DIR/photo_qc_report.csv"
EXIF_REPORT="$TARGET_DIR/exif_summary.csv"
METADATA_REPORT="$TARGET_DIR/photo_metadata_report.json"

echo "Kjører metadata QC-run..."
echo "Kilde: $SOURCE_DIR" | tee "$LOG_FILE"
echo "Run-dir: $TARGET_DIR" | tee -a "$LOG_FILE"
echo "Max files: $MAX_FILES" | tee -a "$LOG_FILE"

if command -v exiftool >/dev/null 2>&1; then
  echo "\n[1/4] ExifTool-eksport" | tee -a "$LOG_FILE"
  exiftool -csv \
    -r \
    -n \
    -GPSLatitude \
    -GPSLongitude \
    -GPSAltitude \
    -DateTimeOriginal \
    -Make \
    -Model \
    "$SOURCE_DIR" > "$EXIF_REPORT" 2>>"$LOG_FILE"
else
  echo "\n[1/4] ExifTool ikke funnet (hopper over). Installer exiftool for full metadata-eksport." | tee -a "$LOG_FILE"
fi

echo "\n[2/4] Enkel metadata-rapport" | tee -a "$LOG_FILE"
python3 "$ROOT_DIR/scripts/extract_photo_metadata.py" \
  --source "$SOURCE_DIR" \
  --output "$METADATA_REPORT" \
  --max-files "$MAX_FILES" \
  >>"$LOG_FILE" 2>&1

echo "\n[3/4] QC-score + zone-analyse" | tee -a "$LOG_FILE"
python3 "$ROOT_DIR/scripts/photo_qc_report.py" \
  --source "$SOURCE_DIR" \
  --output "$PHOTOS_REPORT" \
  --csv "$PHOTOS_REPORT_CSV" \
  --max-files "$MAX_FILES" \
  --pretty \
  --min-confidence 0.72 \
  >>"$LOG_FILE" 2>&1

echo "\n[4/4] Sammendrag" | tee -a "$LOG_FILE"
python3 - "$PHOTOS_REPORT" "$PHOTOS_REPORT_CSV" "$EXIF_REPORT" "$METADATA_REPORT" "$TARGET_DIR" <<'PY'
import json
import sys
from pathlib import Path

photo_report_path = Path(sys.argv[1])
photo_report_csv = Path(sys.argv[2])
exif_report = Path(sys.argv[3])
metadata_report = Path(sys.argv[4])
target_dir = Path(sys.argv[5])

photo_payload = json.loads(photo_report_path.read_text(encoding="utf-8"))
summary = photo_payload.get("summary", {})
quality = summary.get("total_files", 0)
manual = summary.get("need_manual_qc", 0)
low = summary.get("low_confidence", 0)

manifest = {
    "generated_at": photo_payload.get("generated_at"),
    "source": photo_payload.get("source"),
    "total_files": quality,
    "needs_manual_qc": manual,
    "low_confidence": low,
    "min_confidence_threshold": summary.get("min_confidence_threshold"),
    "outputs": {
        "photo_qc_report_json": str(photo_report_path),
        "photo_qc_report_csv": str(photo_report_csv),
        "exif_report_csv": str(exif_report) if exif_report.exists() else None,
        "metadata_report_json": str(metadata_report),
    },
}

(target_dir / "manifest.json").write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(f"Total filer: {quality}")
print(f"Må-ha manuell QC: {manual}")
print(f"Lav score (< {summary.get('min_confidence_threshold', 0.72)}): {low}")
print(f"Manifest: {target_dir / 'manifest.json'}")
PY

echo "\nFerdig." | tee -a "$LOG_FILE"
echo "Rapporter lagret i: $TARGET_DIR" | tee -a "$LOG_FILE"
