#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING_DIR="${STAGING_DIR:-$ROOT_DIR/.staging/webroot}"
HOST="${HOST:-macmini}"
USER="${USER:-henrymeen}"
DEST="${DEST:-/Users/henrymeen/srv/www/flyvendebonder/}"
DRY_RUN=0
LOCAL=0

while (($#)); do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --local)
      LOCAL=1
      shift
      ;;
    --host)
      HOST="$2"
      shift 2
      ;;
    --user)
      USER="$2"
      shift 2
      ;;
    --dest)
      DEST="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--dry-run] [--local] [--host <host>] [--user <user>] [--dest <path>]" >&2
      exit 1
      ;;
  esac
done

"$ROOT_DIR/scripts/prepare-webroot.sh"

RSYNC_OPTS=(
  -av
  --delete
  --exclude ".DS_Store"
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_OPTS+=(--dry-run)
fi

if [[ "$LOCAL" -eq 1 ]]; then
  echo "Deploying locally: $STAGING_DIR -> $DEST"
  rsync "${RSYNC_OPTS[@]}" "$STAGING_DIR/" "$DEST"
else
  echo "Deploying remotely: $STAGING_DIR -> $USER@$HOST:$DEST"
  rsync "${RSYNC_OPTS[@]}" "$STAGING_DIR/" "$USER@$HOST:$DEST"
fi

echo "Deploy completed."
