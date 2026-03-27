#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

if ! command -v cline >/dev/null 2>&1; then
  echo "Cline CLI mangler. Kjor: npm install -g cline" >&2
  exit 1
fi

cd "${REPO_ROOT}"
exec cline kanban "$@"
