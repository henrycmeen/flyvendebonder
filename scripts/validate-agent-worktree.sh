#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_STACK_SMOKE=0
BACKEND_PYTHON="$ROOT_DIR/apps/backend-api/.venv/bin/python"

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  BACKEND_PYTHON="python3"
fi

while (($#)); do
  case "$1" in
    --with-stack-smoke)
      RUN_STACK_SMOKE=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [--with-stack-smoke]" >&2
      exit 1
      ;;
  esac
done

echo "[1/3] Backend tests"
(
  cd "$ROOT_DIR/apps/backend-api"
  "$BACKEND_PYTHON" -m pytest -q
)

echo "[2/3] Frontend lint"
(
  cd "$ROOT_DIR/apps/web-app"
  npm run lint
)

echo "[3/3] Frontend build"
(
  cd "$ROOT_DIR/apps/web-app"
  npm run build
)

if [[ "$RUN_STACK_SMOKE" -eq 1 ]]; then
  echo "[4/4] Stack smoke"
  "$ROOT_DIR/scripts/run-stack-smoke.sh"
fi

echo "Validation OK."
