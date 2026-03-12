#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYMPHONY_ROOT="${SYMPHONY_ROOT:-$HOME/code/openai-symphony}"
WORKFLOW_FILE="$ROOT_DIR/WORKFLOW.md"
SOURCE_REPO_URL="${SYMPHONY_SOURCE_REPO_URL:-$(git -C "$ROOT_DIR" remote get-url origin)}"
SOURCE_REPO_REF="${SYMPHONY_SOURCE_REPO_REF:-$(git -C "$ROOT_DIR" branch --show-current)}"
SYMPHONY_LOGS_ROOT="${SYMPHONY_LOGS_ROOT:-$ROOT_DIR/.symphony-log}"
SYMPHONY_PORT="${SYMPHONY_PORT:-}"

if [[ -z "$SOURCE_REPO_REF" ]]; then
  SOURCE_REPO_REF="main"
fi

load_optional_env_file() {
  local env_file="$1"

  if [[ ! -f "$env_file" ]]; then
    return 0
  fi

  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  set +a
}

if [[ -z "${LINEAR_API_KEY:-}" ]]; then
  load_optional_env_file "$ROOT_DIR/.env"
  load_optional_env_file "$ROOT_DIR/.env.local"
  load_optional_env_file "$ROOT_DIR/.env.symphony"
  load_optional_env_file "$ROOT_DIR/.env.symphony.local"
fi

: "${LINEAR_API_KEY:?Set LINEAR_API_KEY in the shell or in $ROOT_DIR/.env.local before starting Symphony.}"

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
export SYMPHONY_SOURCE_REPO_REF="$SOURCE_REPO_REF"

mkdir -p "$SYMPHONY_LOGS_ROOT"

cd "$SYMPHONY_ROOT/elixir"
mise trust
mise install
mise exec -- mix setup
mise exec -- mix build

ARGS=( "$WORKFLOW_FILE" --logs-root "$SYMPHONY_LOGS_ROOT" )

if [[ -n "$SYMPHONY_PORT" ]]; then
  ARGS+=( --port "$SYMPHONY_PORT" )
fi

if [[ "$#" -gt 0 ]]; then
  ARGS+=( "$@" )
fi

exec mise exec -- ./bin/symphony "${ARGS[@]}"
