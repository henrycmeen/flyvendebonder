#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PHOTOS_ROOT="${1:-$ROOT_DIR/apps/backend-api/storage/photos}"

if [[ ! -d "$PHOTOS_ROOT" ]]; then
  echo "Fant ikke foto-lagring: $PHOTOS_ROOT" >&2
  exit 1
fi

human_bytes() {
  awk -v bytes="$1" '
    function human(x) {
      split("B KB MB GB TB", units, " ");
      i = 1;
      while (x >= 1024 && i < 5) {
        x /= 1024;
        i++;
      }
      return sprintf("%.2f %s", x, units[i]);
    }
    BEGIN { print human(bytes + 0) }
  '
}

variant_stats() {
  local variant="$1"
  local dir="$PHOTOS_ROOT/$variant"
  if [[ ! -d "$dir" ]]; then
    echo "0 0 0"
    return
  fi

  local sizes
  sizes="$(find "$dir" -type f -exec stat -f "%z" {} + 2>/dev/null || true)"

  local count total avg
  count="$(printf "%s\n" "$sizes" | awk 'NF { c++ } END { print c + 0 }')"
  total="$(printf "%s\n" "$sizes" | awk 'NF { s += $1 } END { print s + 0 }')"
  if [[ "$count" -gt 0 ]]; then
    avg=$((total / count))
  else
    avg=0
  fi

  echo "$count $total $avg"
}

read -r original_count original_total original_avg <<< "$(variant_stats original)"
read -r web_count web_total web_avg <<< "$(variant_stats web)"
read -r thumb_count thumb_total thumb_avg <<< "$(variant_stats thumb)"

echo "Stabiliseringsrapport"
echo "Foto-root: $PHOTOS_ROOT"
echo
echo "Antall bilder (original): $original_count"
echo
echo "Variantoversikt:"
printf "  %-10s %8s  %14s  %14s\n" "variant" "count" "total" "avg"
printf "  %-10s %8s  %14s  %14s\n" "original" "$original_count" "$(human_bytes "$original_total")" "$(human_bytes "$original_avg")"
printf "  %-10s %8s  %14s  %14s\n" "web" "$web_count" "$(human_bytes "$web_total")" "$(human_bytes "$web_avg")"
printf "  %-10s %8s  %14s  %14s\n" "thumb" "$thumb_count" "$(human_bytes "$thumb_total")" "$(human_bytes "$thumb_avg")"
echo
echo "Topp 20 største web-filer:"
if [[ -d "$PHOTOS_ROOT/web" ]]; then
  find "$PHOTOS_ROOT/web" -type f -exec stat -f "%z %N" {} + 2>/dev/null | sort -nr | head -20 | while read -r size path; do
    printf "  %12s  %s\n" "$(human_bytes "$size")" "$path"
  done
else
  echo "  Ingen web-katalog funnet."
fi
