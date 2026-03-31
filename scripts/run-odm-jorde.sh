#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Bruk:
  ./scripts/run-odm-jorde.sh "/full/path/til/jorde-mappar" [prosjektnavn]

Eksempel:
  ./scripts/run-odm-jorde.sh "/Users/henmee/Downloads/flyvendebønder vår-test/jorde 3"

Dette scriptet:
  - lager et lokalt ODM-prosjekt under .processing/odm/<prosjektnavn>
  - kopierer JPG-bildene inn i images/
  - kjører OpenDroneMap via Docker

Miljøvariabler:
  ODM_IMAGE                 Docker-image (default: opendronemap/odm:latest)
  ODM_ORTHO_RESOLUTION_CM   Orto-oppløsning i cm/pixel (default: 2)
  ODM_PC_QUALITY            Point cloud quality (default: medium)
  ODM_FEATURE_QUALITY       Feature quality (default: high)
  ODM_MATCHER_NEIGHBORS     Matcher neighbors (default: 8)
  ODM_FAST_ORTHO=0|1        Bruk fast orthophoto (default: 1)
  ODM_SKIP_3DMODEL=0|1      Hopp over teksturert 3D-modell (default: 0)
  ODM_SKIP_REPORT=1         Hopp over ODM-report-steget (default: 1)
  ODM_EXTRA_ARGS            Ekstra argumenter sendt direkte til ODM
  ODM_DRY_RUN=1             Forbered prosjekt og skriv Docker-kommando uten å kjøre

Output:
  .processing/odm/<prosjektnavn>/
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" || $# -lt 1 ]]; then
  usage
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker mangler i PATH." >&2
  exit 1
fi

SOURCE_ARG="${1:-}"
if [[ ! -d "$SOURCE_ARG" ]]; then
  echo "Fant ikke kildemappe: $SOURCE_ARG" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$SOURCE_ARG" && pwd)"
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Fant ikke kildemappe: $SOURCE_DIR" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROCESSING_ROOT="$REPO_ROOT/.processing/odm"

DEFAULT_NAME="$(basename "$SOURCE_DIR" | tr '[:upper:]' '[:lower:]' | tr ' /()' '----' | tr -cd 'a-z0-9_-')"
PROJECT_NAME="${2:-$DEFAULT_NAME}"

if [[ -z "$PROJECT_NAME" ]]; then
  echo "Kunne ikke lage prosjektnavn automatisk." >&2
  exit 1
fi

PROJECT_DIR="$PROCESSING_ROOT/$PROJECT_NAME"
IMAGES_DIR="$PROJECT_DIR/images"
LOG_DIR="$PROJECT_DIR/logs"
MANIFEST_PATH="$PROJECT_DIR/source-manifest.txt"

mkdir -p "$IMAGES_DIR" "$LOG_DIR"
rm -f "$IMAGES_DIR"/*

image_count=0
while IFS= read -r -d '' file; do
  cp -f "$file" "$IMAGES_DIR/$(basename "$file")"
  image_count=$((image_count + 1))
done < <(find "$SOURCE_DIR" -maxdepth 1 -type f \( -iname '*.jpg' -o -iname '*.jpeg' \) -print0 | sort -z)

if [[ "$image_count" -lt 4 ]]; then
  echo "Fant bare $image_count JPG-bilder i $SOURCE_DIR. ODM trenger normalt flere." >&2
  exit 1
fi

cat > "$MANIFEST_PATH" <<EOF
source_dir=$SOURCE_DIR
project_name=$PROJECT_NAME
image_count=$image_count
created_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF

ODM_IMAGE="${ODM_IMAGE:-opendronemap/odm:latest}"
ODM_ORTHO_RESOLUTION_CM="${ODM_ORTHO_RESOLUTION_CM:-2}"
ODM_PC_QUALITY="${ODM_PC_QUALITY:-medium}"
ODM_FEATURE_QUALITY="${ODM_FEATURE_QUALITY:-high}"
ODM_MATCHER_NEIGHBORS="${ODM_MATCHER_NEIGHBORS:-8}"
ODM_FAST_ORTHO="${ODM_FAST_ORTHO:-1}"
ODM_SKIP_3DMODEL="${ODM_SKIP_3DMODEL:-0}"
ODM_SKIP_REPORT="${ODM_SKIP_REPORT:-1}"
ODM_EXTRA_ARGS="${ODM_EXTRA_ARGS:-}"
ODM_DRY_RUN="${ODM_DRY_RUN:-0}"

echo "Starter OpenDroneMap for $PROJECT_NAME"
echo "Kilde: $SOURCE_DIR"
echo "Bilder: $image_count"
echo "Output: $PROJECT_DIR"

DOCKER_CMD=(
  docker run --rm
  -v "$PROCESSING_ROOT:/datasets"
  "$ODM_IMAGE"
  --project-path /datasets
  "$PROJECT_NAME"
  --orthophoto-resolution "$ODM_ORTHO_RESOLUTION_CM"
  --pc-quality "$ODM_PC_QUALITY"
  --feature-quality "$ODM_FEATURE_QUALITY"
  --matcher-neighbors "$ODM_MATCHER_NEIGHBORS"
  --dsm
  --rerun-all
)

if [[ "$ODM_FAST_ORTHO" == "1" ]]; then
  DOCKER_CMD+=(--fast-orthophoto)
fi

if [[ "$ODM_SKIP_REPORT" == "1" ]]; then
  DOCKER_CMD+=(--skip-report)
fi

if [[ "$ODM_SKIP_3DMODEL" == "1" ]]; then
  DOCKER_CMD+=(--skip-3dmodel)
fi

if [[ -n "$ODM_EXTRA_ARGS" ]]; then
  # shellcheck disable=SC2206
  EXTRA_ARGS_ARRAY=($ODM_EXTRA_ARGS)
  DOCKER_CMD+=("${EXTRA_ARGS_ARRAY[@]}")
fi

if [[ "$ODM_DRY_RUN" == "1" ]]; then
  echo
  echo "Dry-run. Kommando som ville blitt kjørt:"
  printf ' %q' "${DOCKER_CMD[@]}"
  echo
  exit 0
fi

"${DOCKER_CMD[@]}" | tee "$LOG_DIR/odm-run.log"

echo
echo "Ferdig. Viktige outputfiler:"
echo "  Ortofoto: $PROJECT_DIR/odm_orthophoto/odm_orthophoto.tif"
echo "  DSM:      $PROJECT_DIR/odm_dem/dsm.tif"
echo "  Punktsky: $PROJECT_DIR/odm_georeferencing/odm_georeferenced_model.laz"
