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
INCIDENTS_DIR="$ROOT_DIR/docs/debug/incidents"
BACKEND_LOG_FILE="${BACKEND_DIR}/logs/backend.log"
BACKEND_LOG_FALLBACK="${HOME}/Library/Logs/flyvendebonder/backend.log"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8787}"
ADMIN_ACCESS_CODE="${ADMIN_ACCESS_CODE:-}"
COOKIE_JAR="$(mktemp)"

cleanup() {
  rm -f "$COOKIE_JAR"
}
trap cleanup EXIT

{
  echo "# Flyvendebønder debug bundle"
  echo "Generated: $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
  echo "Timestamp: $TIMESTAMP"
  echo
} >"${WORK_DIR}/bundle-manifest.txt"

{
  echo "# Privacy and retention notice"
  echo "Classification: confidential operational data"
  echo "Purpose: time-limited incident diagnosis"
  echo "Access: operators with a concrete troubleshooting need"
  echo "Delete no later than: 7 days after generation"
  echo "Do not attach to public issues or pull requests"
  echo "Review and redact backend-tail.txt and logs-api.json before sharing"
  echo "Policy: docs/drift/compliance-retention-v1.md"
} >"${WORK_DIR}/privacy-notice.txt"

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
  echo "Backend URL: $BACKEND_URL"
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
      safe["ENV"] = 1
      safe["HOST"] = 1
      safe["LOG_LEVEL"] = 1
      safe["LOG_TO_CONSOLE"] = 1
      safe["LOG_TO_FILE"] = 1
      safe["NIBIO_GARDSKART_ENABLED"] = 1
      safe["NODE_ENV"] = 1
      safe["PHOTO_AR5_ENABLED"] = 1
      safe["PORT"] = 1
      safe["PYTHONPATH"] = 1
      safe["UVICORN_WORKERS"] = 1
    }
    {
      key = $1
      sub(/=.*/, "", key)
      if (safe[key]) {
        print $0
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
  echo "# Incident summary"
  echo "Source: docs/debug/incidents"
  echo
  if [[ -d "$INCIDENTS_DIR" ]]; then
    python3 - "$INCIDENTS_DIR" <<'PY'
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import sys

incidents_dir = Path(sys.argv[1])
incident_files = sorted(path for path in incidents_dir.glob("*.md") if path.name != "TEMPLATE.md")

if not incident_files:
    print("No incident files found.")
    raise SystemExit

for incident_file in incident_files:
    text = incident_file.read_text(encoding="utf-8")
    metadata: dict[str, str] = {}

    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].splitlines():
                if ":" not in line:
                    continue
                key, value = line.split(":", 1)
                metadata[key.strip()] = value.strip().strip('"')

    title = incident_file.stem
    for line in text.splitlines():
        if line.startswith("# Incident:"):
            title = line.removeprefix("# Incident:").strip()
            break

    updated_at = datetime.fromtimestamp(incident_file.stat().st_mtime, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    print(f"- {title}")
    print(f"  file: docs/debug/incidents/{incident_file.name}")
    print(f"  slug: {metadata.get('slug', 'unknown')}")
    print(f"  reported_by: {metadata.get('reported_by', 'unknown')}")
    print(f"  status: {metadata.get('status', 'unknown')}")
    print(f"  issue: {metadata.get('issue', 'unknown')}")
    print(f"  updated: {updated_at}")
PY
  else
    echo "No incident directory found."
    echo "Checked: $INCIDENTS_DIR"
  fi
} >"${WORK_DIR}/incident-summary.txt"

{
  echo "# API smoke (if backend is running)"
  if curl -fsS "$BACKEND_URL/api/v1/health" >/dev/null 2>&1; then
    curl -fsS "$BACKEND_URL/api/v1/health" | tee "${WORK_DIR}/health.json"
  else
    echo "Backend not reachable on $BACKEND_URL"
  fi

  if curl -fsS "$BACKEND_URL/api/v1/admin/session" >"${WORK_DIR}/admin-session.json" 2>/dev/null; then
    cat "${WORK_DIR}/admin-session.json"
  else
    echo "Admin session endpoint not reachable."
  fi

  LOGS_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "$BACKEND_URL/api/v1/logs?limit=20" || true)"
  if [[ "$LOGS_STATUS" == "200" ]]; then
    curl -fsS "$BACKEND_URL/api/v1/logs?limit=20" >"${WORK_DIR}/logs-api.json"
  elif [[ "$LOGS_STATUS" == "401" ]]; then
    echo "Logs endpoint krever admin-session."
    if [[ -n "$ADMIN_ACCESS_CODE" ]]; then
      LOGIN_PAYLOAD="$(python3 - "$ADMIN_ACCESS_CODE" <<'PY'
import json
import sys

print(json.dumps({"code": sys.argv[1]}))
PY
)"
      LOGIN_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" -c "$COOKIE_JAR" -H "Content-Type: application/json" -d "$LOGIN_PAYLOAD" "$BACKEND_URL/api/v1/admin/login" || true)"
      if [[ "$LOGIN_STATUS" == "200" ]]; then
        curl -fsS -b "$COOKIE_JAR" "$BACKEND_URL/api/v1/logs?limit=20" >"${WORK_DIR}/logs-api.json"
        echo "Logs hentet med ADMIN_ACCESS_CODE."
      else
        echo "Admin-login for logs feilet (HTTP ${LOGIN_STATUS})."
      fi
    else
      echo "Sett ADMIN_ACCESS_CODE for å inkludere beskyttede backendlogger i bundlen."
    fi
  else
    echo "Logs endpoint svarte HTTP ${LOGS_STATUS}."
  fi
} >"${WORK_DIR}/api-smoke.txt"

tar -czf "$TARGET" -C "$OUTPUT_DIR" "$BUNDLE_NAME"
rm -rf "$WORK_DIR"

echo "Debug bundle skrevet: $TARGET"
