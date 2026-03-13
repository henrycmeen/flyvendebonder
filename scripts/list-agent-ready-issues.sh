#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="henrycmeen/flyvendebonder"
REPO="${1:-$DEFAULT_REPO}"
LIMIT="${LIMIT:-20}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI mangler." >&2
  exit 1
fi

gh issue list \
  --repo "$REPO" \
  --state open \
  --label "agent-safe" \
  --limit "$LIMIT"
