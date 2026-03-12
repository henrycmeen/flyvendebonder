#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/apps/backend-api"
WEB_DIR="$ROOT_DIR/apps/web-app"
BACKEND_VENV="$BACKEND_DIR/.venv"
PYTHON_BIN="${PYTHON_BIN:-python3}"

if [[ ! -x "$BACKEND_VENV/bin/python" ]]; then
  "$PYTHON_BIN" -m venv "$BACKEND_VENV"
fi

"$BACKEND_VENV/bin/python" -m pip install --upgrade pip
"$BACKEND_VENV/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"

npm --prefix "$WEB_DIR" ci
