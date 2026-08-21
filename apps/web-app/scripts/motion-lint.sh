#!/usr/bin/env bash
set -euo pipefail

if ! command -v grep >/dev/null 2>&1; then
  echo "motion-lint: nødvendig verktøy 'grep' mangler på PATH." >&2
  exit 2
fi

failures=0

if grep -rInE "transition-all" src; then
  echo "motion-lint: 'transition-all' funnet i web-app-koden. Bruk eksplisitte transition-egenskaper i stedet."
  failures=1
fi

if grep -rInE "transition:[[:space:]]*linear([^[:alnum:]_]|$)|transition:[[:print:][:space:]]*[^[:alnum:]_]linear([^[:alnum:]_]|$)|transition-timing-function:[[:space:]]*linear([^[:alnum:]_]|$)" src; then
  echo "motion-lint: eksplisitt 'linear' brukt på transition. Vurder andre easing-profiler for UX-konsistens."
  failures=1
fi

if grep -rInE "animation:[[:space:]]*linear([^[:alnum:]_]|$)|animation:[[:print:][:space:]]*[^[:alnum:]_]linear([^[:alnum:]_]|$)" src; then
  echo "motion-lint: observasjoner av 'linear' i animation er funnet. Gjennomgå om dette er bevisste, ikke-interaktive loop-grep."
fi

if [ "$failures" -ne 0 ]; then
  echo "motion-lint: blokkert."
  exit 1
fi

echo "motion-lint: OK"
