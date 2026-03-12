#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/apps/backend-api"

APP_ROOT="${APP_ROOT:-/Users/henrymeen/srv/apps/flyvendebonder}"
TARGET_DIR="${TARGET_DIR:-$APP_ROOT/apps/backend-api}"
VENV_DIR="${VENV_DIR:-$APP_ROOT/.venv}"
LAUNCH_AGENT="${LAUNCH_AGENT:-$HOME/Library/LaunchAgents/com.flyvendebonder.backend.plist}"
SERVICE_LABEL="${SERVICE_LABEL:-com.flyvendebonder.backend}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8787/api/v1/health}"
WAIT_SECONDS="${WAIT_SECONDS:-45}"

DRY_RUN=0
SKIP_RESTART=0

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-backend-macmini.sh [options]

Options:
  --app-root PATH      Target root on Mac mini (default: /Users/henrymeen/srv/apps/flyvendebonder)
  --target-dir PATH    Override backend target dir
  --venv-dir PATH      Override venv dir
  --launch-agent PATH  Override LaunchAgent plist
  --service-label STR  Override launchctl service label
  --health-url URL     Override backend health URL
  --wait-seconds N     Seconds to wait for health check (default: 45)
  --skip-restart       Sync code and install deps, but do not restart/check health
  --dry-run            Show sync actions without changing files or restarting
  -h, --help           Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-root)
      APP_ROOT="$2"
      TARGET_DIR="$APP_ROOT/apps/backend-api"
      VENV_DIR="$APP_ROOT/.venv"
      shift 2
      ;;
    --target-dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --venv-dir)
      VENV_DIR="$2"
      shift 2
      ;;
    --launch-agent)
      LAUNCH_AGENT="$2"
      shift 2
      ;;
    --service-label)
      SERVICE_LABEL="$2"
      shift 2
      ;;
    --health-url)
      HEALTH_URL="$2"
      shift 2
      ;;
    --wait-seconds)
      WAIT_SECONDS="$2"
      shift 2
      ;;
    --skip-restart)
      SKIP_RESTART=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Missing source backend dir: $SOURCE_DIR" >&2
  exit 1
fi

RSYNC_ARGS=(
  -a
  --delete
  --exclude=.env
  --exclude=data/
  --exclude=logs/
  --exclude=storage/
  --exclude=tests/
  --exclude=__pycache__/
  --exclude=.pytest_cache/
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi

echo "Sync backend from $SOURCE_DIR to $TARGET_DIR"
mkdir -p "$TARGET_DIR" "$TARGET_DIR/data" "$TARGET_DIR/logs"
rsync "${RSYNC_ARGS[@]}" "$SOURCE_DIR/" "$TARGET_DIR/"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Dry-run complete."
  exit 0
fi

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  echo "Create virtualenv in $VENV_DIR"
  mkdir -p "$APP_ROOT"
  python3 -m venv "$VENV_DIR"
fi

echo "Install backend dependencies"
"$VENV_DIR/bin/python" -m pip install -r "$TARGET_DIR/requirements.txt"

if [[ "$SKIP_RESTART" -eq 1 ]]; then
  echo "Skip restart requested. Backend files synced and dependencies installed."
  exit 0
fi

if [[ ! -f "$LAUNCH_AGENT" ]]; then
  echo "Missing LaunchAgent plist: $LAUNCH_AGENT" >&2
  exit 1
fi

echo "Restart backend service $SERVICE_LABEL"
launchctl unload "$LAUNCH_AGENT" 2>/dev/null || true
launchctl load "$LAUNCH_AGENT"
launchctl start "$SERVICE_LABEL" 2>/dev/null || true

echo "Wait for health endpoint: $HEALTH_URL"
for ((attempt=1; attempt<=WAIT_SECONDS; attempt++)); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "Backend health check OK after ${attempt}s."
    exit 0
  fi
  sleep 1
done

echo "Backend health check failed after ${WAIT_SECONDS}s." >&2
exit 1
