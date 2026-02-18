#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend-api"
WEB_DIR="$ROOT_DIR/apps/web-app"
WEB_PORT=5173

BACKEND_PID=""
STARTED_BACKEND=0
BACKEND_READY_CHECK_URL="http://127.0.0.1:8787/api/v1/photos/page?date=2000-01-01&mode=cumulative&limit=1"
BACKEND_LOGS_CHECK_URL="http://127.0.0.1:8787/api/v1/logs?limit=1"

start_backend() {
  echo "Starting backend on 127.0.0.1:8787 ..."
  (
    cd "$BACKEND_DIR"
    python3 server.py
  ) > /tmp/flyv-backend-dev.log 2>&1 &

  BACKEND_PID=$!
  STARTED_BACKEND=1

  for _ in {1..30}; do
    if curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null 2>&1; then
      break
    fi
    sleep 0.3
  done

  if ! curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null 2>&1; then
    echo "Backend failed to start. See /tmp/flyv-backend-dev.log" >&2
    exit 1
  fi
}

cleanup() {
  if [[ "$STARTED_BACKEND" -eq 1 && -n "$BACKEND_PID" ]]; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if ! lsof -nP -iTCP:8787 -sTCP:LISTEN >/dev/null 2>&1; then
  start_backend
else
  echo "Backend already running on :8787"

  if ! curl -fsS "$BACKEND_READY_CHECK_URL" >/dev/null 2>&1 || ! curl -fsS "$BACKEND_LOGS_CHECK_URL" >/dev/null 2>&1; then
    echo "Existing backend is missing required API routes, restarting ..."
    OLD_BACKEND_PIDS="$(lsof -tiTCP:8787 -sTCP:LISTEN | tr '\n' ' ')"
    if [[ -n "$OLD_BACKEND_PIDS" ]]; then
      kill $OLD_BACKEND_PIDS 2>/dev/null || true
      sleep 0.6
    fi
    start_backend
  fi
fi

if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  LISTEN_PIDS="$(lsof -tiTCP:"$WEB_PORT" -sTCP:LISTEN | paste -sd, -)"
  if ps -p "$LISTEN_PIDS" -o command= | grep -q "$WEB_DIR/node_modules/.bin/vite"; then
    # Keep backend alive if we just started it and frontend is already running.
    STARTED_BACKEND=0
    echo "Frontend already running on http://127.0.0.1:${WEB_PORT}/app/"
    exit 0
  fi

  if ! ps -p "$LISTEN_PIDS" -o command= | grep -q "$WEB_DIR/node_modules/.bin/vite"; then
    echo "Port $WEB_PORT is already in use by another app. Stop it first, then retry." >&2
    echo "Hint: lsof -nP -iTCP:$WEB_PORT -sTCP:LISTEN" >&2
    exit 1
  fi
fi

echo "Starting frontend on http://127.0.0.1:${WEB_PORT}/app/ ..."
cd "$WEB_DIR"
npm run dev -- --host 127.0.0.1 --port "$WEB_PORT"
