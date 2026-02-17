#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="${STAGING_DIR:-$ROOT_DIR/.staging/webroot}"

echo "Preparing staging webroot at: $STAGING_DIR"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$STAGING_DIR/assets" "$STAGING_DIR/demo"

RSYNC_OPTS=(
  -a
  --delete
  --exclude ".DS_Store"
  --exclude "README.md"
)

rsync "${RSYNC_OPTS[@]}" "$ROOT_DIR/apps/info-site/" "$STAGING_DIR/"
rsync "${RSYNC_OPTS[@]}" "$ROOT_DIR/apps/shared-assets/" "$STAGING_DIR/assets/"
rsync "${RSYNC_OPTS[@]}" "$ROOT_DIR/apps/demo-fotokart/" "$STAGING_DIR/demo/"

echo "Staging complete."
echo "Root site: $STAGING_DIR/index.html"
echo "Demo site: $STAGING_DIR/demo/index.html"
