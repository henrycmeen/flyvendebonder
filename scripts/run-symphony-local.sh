#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYMPHONY_ROOT="${SYMPHONY_ROOT:-$HOME/code/openai-symphony}"
WORKFLOW_FILE="$ROOT_DIR/WORKFLOW.md"
SOURCE_REPO_URL="${SYMPHONY_SOURCE_REPO_URL:-$(git -C "$ROOT_DIR" remote get-url origin)}"

: "${LINEAR_API_KEY:?Set LINEAR_API_KEY before starting Symphony.}"

if ! command -v mise >/dev/null 2>&1; then
  echo "mise is required to run Symphony Elixir locally." >&2
  exit 1
fi

if [[ ! -d "$SYMPHONY_ROOT/.git" ]]; then
  git clone https://github.com/openai/symphony "$SYMPHONY_ROOT"
else
  git -C "$SYMPHONY_ROOT" pull --ff-only
fi

export SYMPHONY_SOURCE_REPO_URL="$SOURCE_REPO_URL"

cd "$SYMPHONY_ROOT/elixir"
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build
exec mise exec -- ./bin/symphony "$WORKFLOW_FILE" "$@"
