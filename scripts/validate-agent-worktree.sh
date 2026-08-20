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

echo "[1/5] Project storage link tests"
"$ROOT_DIR/scripts/tests/test-setup-project-storage-link.sh"

echo "[2/5] Backend tests"
(
  cd "$ROOT_DIR/apps/backend-api"
  "$BACKEND_PYTHON" -m pytest -q
)

echo "[3/5] Frontend tests"
(
  cd "$ROOT_DIR/apps/web-app"
  npm run test
)

echo "[4/5] Frontend lint"
(
  cd "$ROOT_DIR/apps/web-app"
  npm run lint
)

echo "[5/5] Frontend build"
(
  cd "$ROOT_DIR/apps/web-app"
  npm run build
)

if [[ "$RUN_STACK_SMOKE" -eq 1 ]]; then
  echo "[6/6] Stack smoke"
  "$ROOT_DIR/scripts/run-stack-smoke.sh"
fi

echo "Validation OK."
