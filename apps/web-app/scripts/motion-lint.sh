#!/usr/bin/env bash
set -euo pipefail

failures=0

if rg -n "transition-all" src; then
  echo "motion-lint: 'transition-all' funnet i web-app-koden. Bruk eksplisitte transition-egenskaper i stedet."
  failures=1
fi

if rg -n "transition:[^\\n]*\\blinear\\b|transition-timing-function:\\s*linear" src; then
  echo "motion-lint: eksplisitt 'linear' brukt på transition. Vurder andre easing-profiler for UX-konsistens."
  failures=1
fi

if rg -n "animation:[^\\n]*\\blinear\\b" src; then
  echo "motion-lint: observasjoner av 'linear' i animation er funnet. Gjennomgå om dette er bevisste, ikke-interaktive loop-grep."
fi

if [ "$failures" -ne 0 ]; then
  echo "motion-lint: blokkert."
  exit 1
fi

echo "motion-lint: OK"
