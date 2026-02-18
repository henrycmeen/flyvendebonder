#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="${STAGING_DIR:-$ROOT_DIR/.staging/webroot}"
WEB_APP_DIR="$ROOT_DIR/apps/web-app"
WEB_APP_DIST="$WEB_APP_DIR/dist"

echo "Preparing staging webroot at: $STAGING_DIR"

if [[ ! -d "$WEB_APP_DIR/node_modules" ]]; then
  echo "Installing frontend dependencies (apps/web-app)"
  (cd "$WEB_APP_DIR" && npm install)
fi

echo "Building React frontend (apps/web-app)"
(cd "$WEB_APP_DIR" && npm run build)

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$STAGING_DIR/assets" "$STAGING_DIR/app"

RSYNC_OPTS=(
  -a
  --delete
  --exclude ".DS_Store"
  --exclude "README.md"
)

rsync "${RSYNC_OPTS[@]}" "$ROOT_DIR/apps/info-site/" "$STAGING_DIR/"
rsync "${RSYNC_OPTS[@]}" "$ROOT_DIR/apps/shared-assets/" "$STAGING_DIR/assets/"
rsync "${RSYNC_OPTS[@]}" "$WEB_APP_DIST/" "$STAGING_DIR/app/"

echo "Staging complete."
echo "Root site: $STAGING_DIR/index.html"
echo "App site: $STAGING_DIR/app/index.html"
