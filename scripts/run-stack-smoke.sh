#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend-api"
WEB_DIR="$ROOT_DIR/apps/web-app"
BACKEND_PORT="${BACKEND_PORT:-8787}"
APP_PORT="${APP_PORT:-5173}"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:${BACKEND_PORT}}"
APP_URL="${APP_URL:-http://127.0.0.1:${APP_PORT}/app/}"
BACKEND_PID=""
WEB_PID=""
STARTUP_TIMEOUT_SECONDS="${STARTUP_TIMEOUT_SECONDS:-120}"
SMOKE_STATE_DIR="${SMOKE_STATE_DIR:-}"
AUTO_STATE_DIR=0
SUCCESS=0

if [[ -z "$SMOKE_STATE_DIR" ]]; then
  SMOKE_STATE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/flyv-smoke.XXXXXX")"
  AUTO_STATE_DIR=1
else
  mkdir -p "$SMOKE_STATE_DIR"
fi

BACKEND_LOG="${BACKEND_LOG:-$SMOKE_STATE_DIR/backend.log}"
WEB_LOG="${WEB_LOG:-$SMOKE_STATE_DIR/web-preview.log}"
LOG_FILE_PATH="${LOG_FILE_PATH:-$SMOKE_STATE_DIR/backend-app.log}"
DATABASE_URL="${DATABASE_URL:-sqlite:///$SMOKE_STATE_DIR/flyvendebonder-smoke.db}"
APP_DATA_ROOT="${APP_DATA_ROOT:-$SMOKE_STATE_DIR/storage}"
ADMIN_ACCESS_CODE="${ADMIN_ACCESS_CODE:-test-admin-code}"
ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-test-admin-secret}"
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  BACKEND_PYTHON="python3"
fi

fail() {
  echo "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$WEB_PID" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
    wait "$WEB_PID" 2>/dev/null || true
  fi
  if [[ -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ "$SUCCESS" -eq 1 && "$AUTO_STATE_DIR" -eq 1 ]]; then
    rm -rf "$SMOKE_STATE_DIR"
  elif [[ "$SUCCESS" -ne 1 ]]; then
    echo "Smoke state beholdes i $SMOKE_STATE_DIR" >&2
  fi
}
trap cleanup EXIT INT TERM

ensure_port_free() {
  local port="$1"
  local label="$2"

  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    fail "$label-port $port er allerede i bruk. Frigjør porten eller sett egen BACKEND_PORT/APP_PORT."
  fi
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local max_attempts

  max_attempts=$((STARTUP_TIMEOUT_SECONDS * 2))

  for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done

  fail "$label svarte ikke i tide etter ${STARTUP_TIMEOUT_SECONDS}s. Se loggene: $BACKEND_LOG og $WEB_LOG"
}

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  fail "Frontend-avhengigheter mangler. Kjør 'cd apps/web-app && npm ci' først."
fi

if [[ ! -d "$WEB_DIR/dist" ]]; then
  fail "Frontend-build mangler. Kjør './scripts/validate-agent-worktree.sh' eller 'cd apps/web-app && npm run build' først."
fi

ensure_port_free "$BACKEND_PORT" "Backend"
ensure_port_free "$APP_PORT" "Frontend"

echo "Starting backend on $BACKEND_URL ..."
(
  cd "$BACKEND_DIR"
  DATABASE_URL="$DATABASE_URL" \
  APP_DATA_ROOT="$APP_DATA_ROOT" \
  HOST="127.0.0.1" \
  PORT="$BACKEND_PORT" \
  LOG_TO_FILE="false" \
  LOG_FILE_PATH="$LOG_FILE_PATH" \
  NIBIO_GARDSKART_ENABLED="${NIBIO_GARDSKART_ENABLED:-false}" \
  PHOTO_AR5_WMS_URL="" \
  PHOTO_AR5_WMS_LAYERS="" \
  PHOTO_SOIL_WMS_URL="" \
  PHOTO_SOIL_WMS_LAYERS="" \
  PHOTO_AR5_WFS_URL="" \
  PHOTO_AR5_WFS_LAYERS="" \
  PHOTO_SOIL_WFS_URL="" \
  PHOTO_SOIL_WFS_LAYERS="" \
  ADMIN_ACCESS_CODE="$ADMIN_ACCESS_CODE" \
  ADMIN_SESSION_SECRET="$ADMIN_SESSION_SECRET" \
  PYTHONUNBUFFERED=1 \
  "$BACKEND_PYTHON" server.py
) >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

wait_for_url "$BACKEND_URL/api/v1/health" "Backend"

echo "Starting frontend preview on $APP_URL ..."
(
  cd "$WEB_DIR"
  npm run preview -- --host 127.0.0.1 --port "$APP_PORT"
) >"$WEB_LOG" 2>&1 &
WEB_PID=$!

wait_for_url "$APP_URL" "Frontend"

echo "Running API + frontend smoke ..."
BACKEND_URL="$BACKEND_URL" APP_URL="$APP_URL" "$ROOT_DIR/scripts/smoke-flyvendebonder.sh"

SUCCESS=1
echo "Stack smoke OK."
