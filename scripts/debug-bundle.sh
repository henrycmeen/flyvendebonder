#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="${1:-$ROOT_DIR/.debug-bundles}"
LINES="${2:-220}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BUNDLE_NAME="flyvendebonder-debug-${TIMESTAMP}"

mkdir -p "$OUTPUT_DIR"
WORK_DIR="${OUTPUT_DIR}/${BUNDLE_NAME}"
mkdir -p "$WORK_DIR"
TARGET="${OUTPUT_DIR}/${BUNDLE_NAME}.tgz"

BACKEND_DIR="$ROOT_DIR/apps/backend-api"
WEB_DIR="$ROOT_DIR/apps/web-app"
BACKEND_LOG_FILE="${BACKEND_DIR}/logs/backend.log"
BACKEND_LOG_FALLBACK="${HOME}/Library/Logs/flyvendebonder/backend.log"

{
  echo "# Flyvendebønder debug bundle"
  echo "Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
  echo "Timestamp: $TIMESTAMP"
  echo
} >"${WORK_DIR}/bundle-manifest.txt"

{
  echo "# Git + repo"
  echo "Branch: $(git -C "$ROOT_DIR" rev-parse --abbrev-ref HEAD)"
  echo "SHA: $(git -C "$ROOT_DIR" rev-parse HEAD)"
  echo "Remote: $(git -C "$ROOT_DIR" remote get-url origin)"
  echo "Clean working tree: $(if git -C "$ROOT_DIR" status --porcelain | grep -q .; then echo false; else echo true; fi)"
  echo
  echo "# Runtime"
  echo "Node: $(command -v node >/dev/null && node --version || echo missing)"
  echo "NPM: $(command -v npm >/dev/null && npm --version || echo missing)"
  echo "Python: $(command -v python3 >/dev/null && python3 --version || echo missing)"
  echo "Host: $(uname -a)"
  echo
  echo "# App metadata"
  if [[ -f "$ROOT_DIR/package.json" ]]; then
    node -p "JSON.parse(require('fs').readFileSync('$ROOT_DIR/package.json','utf8')).name" 2>/dev/null || true
  fi
  if [[ -f "$BACKEND_DIR/pyproject.toml" ]]; then
    python3 - "$BACKEND_DIR/pyproject.toml" <<'PY'
import re, sys
path = sys.argv[1]
name = "unknown"
version = "unknown"
for line in open(path, "r", encoding="utf-8"):
    if line.startswith("name = "):
        name = line.split("=", 1)[1].strip().strip('"')
    if line.startswith("version = "):
        version = line.split("=", 1)[1].strip().strip('"')
print(f"{name}=={version}")
PY
  fi
} >"${WORK_DIR}/runtime.txt"

{
  echo "# Config files"
  if [[ -f "$BACKEND_DIR/app/config.py" ]]; then
    sed -n '1,220p' "$BACKEND_DIR/app/config.py"
  else
    echo "Missing: $BACKEND_DIR/app/config.py"
  fi
  echo
  if [[ -f "$BACKEND_DIR/pyproject.toml" ]]; then
    echo "---"
    sed -n '1,260p' "$BACKEND_DIR/pyproject.toml"
  fi
  echo
  if [[ -f "$WEB_DIR/package.json" ]]; then
    echo "---"
    cat "$WEB_DIR/package.json"
  fi
} >"${WORK_DIR}/config-snapshot.txt"

{
  echo "# Whitelisted runtime env (masked)"
  echo "Path: $PATH"
  echo
  env | sort | awk -F= '
    BEGIN {
      split("FB_,VITE_,NIBIO_,API_,DATABASE_,LOG_,PORT,HOST,PYTHON,NODE,UVICORN", whitelist_arr, ",")
    }
    function is_whitelisted(key, i, n, part, hit) {
      hit = 0
      for (i = 1; i <= length(whitelist_arr); i++) {
        part = whitelist_arr[i]
        if (index(key, part) == 1) {
          hit = 1
        }
      }
      return hit
    }
    function should_mask(key) {
      return (tolower(key) ~ /token|secret|pass|apikey|api[_-]?key|private|credential|bearer/)
    }
    {
      key = $1
      sub(/=.*/, "", key)
      if (is_whitelisted(key)) {
        if (should_mask(key)) {
          value = substr($0, length(key) + 2)
          if (length(value) > 6) {
            value = substr(value, 1, 3) "..." substr(value, length(value) - 2)
          } else {
            value = "***MASKED***"
          }
          printf "%s=%s\n", key, value
        } else {
          print $0
        }
      }
    }
  '
} >"${WORK_DIR}/env-whitelist.txt"

{
  echo "# Backend logs ($LINES)"
  if [[ -s "$BACKEND_LOG_FILE" ]]; then
    tail -n "$LINES" "$BACKEND_LOG_FILE"
  elif [[ -s "$BACKEND_LOG_FALLBACK" ]]; then
    tail -n "$LINES" "$BACKEND_LOG_FALLBACK"
  else
    echo "No backend log file found."
    echo "Checked:"
    echo " - $BACKEND_LOG_FILE"
    echo " - $BACKEND_LOG_FALLBACK"
  fi
} >"${WORK_DIR}/backend-tail.txt"

{
  echo "# Frontend diagnostics"
  echo "Frontend build dir: $WEB_DIR/dist"
  if [[ -d "$WEB_DIR/dist" ]]; then
    echo "dist exists: yes"
    find "$WEB_DIR/dist" -maxdepth 2 -type f | sort | head -50
  else
    echo "dist exists: no"
  fi

  echo
  echo "Frontend node_modules present: $([[ -d \"$WEB_DIR/node_modules\" ]] && echo yes || echo no)"
} >"${WORK_DIR}/frontend-debug.txt"

{
  echo "# API smoke (if backend is running)"
  if curl -fsS http://127.0.0.1:8787/api/v1/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8787/api/v1/health | tee "${WORK_DIR}/health.json"
  else
    echo "Backend not reachable on 127.0.0.1:8787"
  fi
  if curl -fsS http://127.0.0.1:8787/api/v1/logs?limit=20 >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8787/api/v1/logs?limit=20 >"${WORK_DIR}/logs-api.json"
  else
    echo "Logs endpoint not reachable."
  fi
} >"${WORK_DIR}/api-smoke.txt"

tar -czf "$TARGET" -C "$OUTPUT_DIR" "$BUNDLE_NAME"
rm -rf "$WORK_DIR"

echo "Debug bundle skrevet: $TARGET"
