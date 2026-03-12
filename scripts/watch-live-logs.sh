#!/usr/bin/env bash
set -euo pipefail

HOST="${1:-macmini}"
REMOTE_BACKEND_LOG="${REMOTE_BACKEND_LOG:-/Users/henrymeen/srv/apps/flyvendebonder/apps/backend-api/logs/backend.log}"
REMOTE_STDOUT_LOG="${REMOTE_STDOUT_LOG:-/Users/henrymeen/Library/Logs/flyvendebonder-backend.out.log}"
REMOTE_STDERR_LOG="${REMOTE_STDERR_LOG:-/Users/henrymeen/Library/Logs/flyvendebonder-backend.err.log}"

ssh "$HOST" "
  set -euo pipefail
  files=(
    \"$REMOTE_BACKEND_LOG\"
    \"$REMOTE_STDOUT_LOG\"
    \"$REMOTE_STDERR_LOG\"
  )

  echo \"Logger fra \$(hostname) som \$(whoami)\"
  echo

  for file in \"\${files[@]}\"; do
    if [ -f \"\$file\" ]; then
      printf '===== %s (siste 40) =====\n' \"\$file\"
      tail -n 40 \"\$file\"
      echo
    else
      printf '===== mangler: %s =====\n\n' \"\$file\"
    fi
  done

  exec tail -n 0 -F \"\${files[@]}\"
"
