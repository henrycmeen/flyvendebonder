#!/usr/bin/env bash

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Bruk: ./scripts/run-odm-jorder-batch.sh '/full/path/til/rotnivå-med-jorder'" >&2
  exit 1
fi

ROOT_DIR="$1"
if [[ ! -d "$ROOT_DIR" ]]; then
  echo "Fant ikke rotmappe: $ROOT_DIR" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for dir in "$ROOT_DIR"/*; do
  [[ -d "$dir" ]] || continue
  base="$(basename "$dir")"
  case "$base" in
    "jorde 3"|"jorde 6 (M48)")
      echo "Hopper over $base (allerede kjørt)"
      continue
      ;;
  esac

  project_name="$(printf '%s' "$base" | tr '[:upper:]' '[:lower:]' | tr ' /()' '----' | tr -cd 'a-z0-9_-')"
  echo
  echo "=== Kjøring for $base -> $project_name ==="
  ODM_FAST_ORTHO="${ODM_FAST_ORTHO:-0}" \
  ODM_PC_QUALITY="${ODM_PC_QUALITY:-high}" \
  ODM_FEATURE_QUALITY="${ODM_FEATURE_QUALITY:-high}" \
  ODM_MATCHER_NEIGHBORS="${ODM_MATCHER_NEIGHBORS:-12}" \
  ODM_ORTHO_RESOLUTION_CM="${ODM_ORTHO_RESOLUTION_CM:-1}" \
  ODM_SKIP_3DMODEL="${ODM_SKIP_3DMODEL:-1}" \
  ODM_SKIP_REPORT="${ODM_SKIP_REPORT:-1}" \
  ODM_EXTRA_ARGS="${ODM_EXTRA_ARGS:---min-num-features 12000}" \
  "$SCRIPT_DIR/run-odm-jorde.sh" "$dir" "$project_name"
done
