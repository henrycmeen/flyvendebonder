#!/usr/bin/env bash
set -euo pipefail

DEFAULT_REPO="henrycmeen/flyvendebonder"
REPO="${1:-$DEFAULT_REPO}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI mangler." >&2
  exit 1
fi

LABELS=(
  "agent-safe|Trygg kandidat for små agentiske PR-løp|1b8a5a"
  "frontend-safe|Frontend-endring med lav risiko og tydelig verifisering|0e8a16"
  "backend-risky|Backend-endring som krever ekstra menneskelig review|b60205"
  "needs-human|Krever manuell vurdering, avklaring eller driftshjelp|d93f0b"
  "blocked|Kan ikke tas videre før ekstern avklaring eller avhengighet er løst|5319e7"
  "docs-only|Dokumentasjon eller tekstendring uten kodepåvirkning|0366d6"
)

for entry in "${LABELS[@]}"; do
  IFS="|" read -r name description color <<<"$entry"
  gh label create "$name" \
    --repo "$REPO" \
    --color "$color" \
    --description "$description" \
    --force >/dev/null
  echo "Synket label: $name"
done

echo "Label-sync ferdig for $REPO."
