#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8787}"
APP_URL="${APP_URL:-http://127.0.0.1:5173/app/}"
ADMIN_ACCESS_CODE="${ADMIN_ACCESS_CODE:-}"

TMP_FILES=()

cleanup() {
  if ((${#TMP_FILES[@]})); then
    rm -f "${TMP_FILES[@]}"
  fi
}
trap cleanup EXIT

new_tmp() {
  local path
  path="$(mktemp)"
  TMP_FILES+=("$path")
  printf '%s\n' "$path"
}

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

require_200() {
  local url="$1"
  local label="$2"
  local output_file="${3:-/dev/null}"
  local response
  local code

  response="$(mktemp)"
  code="$(curl -sS -w "%{http_code}" -o "$response" "$url")"
  if [[ "$code" != "200" ]]; then
    rm -f "$response"
    fail "$label ($code): $url"
  fi
  cat "$response" >"$output_file"
  rm -f "$response"
}

require_json_field() {
  local label="$1"
  local url="$2"
  local expression="$3"
  local response
  local code

  response="$(new_tmp)"
  code="$(curl -A "flyvendebonder-smoke/1.0" -sS -w "%{http_code}" -o "$response" "$url")"
  if [[ "$code" != "200" ]]; then
    fail "$label ($code): $url"
  fi

  local result
  result="$(python3 - "$response" "$expression" <<'PY'
import json
import sys

path, expr = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

if not eval(expr, {"obj": payload}):
    raise SystemExit(1)
print("ok")
PY
)"
  if [[ "$result" != "ok" ]]; then
    fail "$label"
  fi
}

extract_json_field() {
  local url="$1"
  local expression="$2"
  local response
  local code

  response="$(new_tmp)"
  code="$(curl -A "flyvendebonder-smoke/1.0" -sS -w "%{http_code}" -o "$response" "$url")"
  if [[ "$code" != "200" ]]; then
    fail "Kunne ikke hente JSON-felt ($code): $url"
  fi

  python3 - "$response" "$expression" <<'PY'
import json
import sys

path, expr = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as handle:
    payload = json.load(handle)

print(eval(expr, {"obj": payload}))
PY
}

echo "[1/5] Backend health"
require_json_field "Health payload" "$BACKEND_URL/api/v1/health" "obj.get('status') == 'ok'"

echo "[2/5] Profile og timeline"
require_json_field "Profile payload" "$BACKEND_URL/api/v1/profile/current" "obj.get('user', {}).get('full_name') == 'Roar Meen'"
require_json_field "Timeline payload" "$BACKEND_URL/api/v1/timeline/dates" "len(obj.get('dates', [])) >= 1"
require_json_field "Property payload" "$BACKEND_URL/api/v1/properties/current" "obj.get('property', {}).get('komm') == '4003' and obj.get('property', {}).get('gnr') == 70 and obj.get('property', {}).get('bnr') == 17"
require_json_field "Gardskart job payload" "$BACKEND_URL/api/v1/properties/current/gardskart-job" "bool(obj.get('job_id'))"

echo "[3/5] Photo-feed og paginering"
DATE="$(extract_json_field "$BACKEND_URL/api/v1/timeline/dates" "obj.get('dates')[-1]['date']")"
if [[ -z "$DATE" ]]; then
  fail "Fant ingen dato i timeline"
fi

PAGE_URL="$BACKEND_URL/api/v1/photos/page?date=$DATE&mode=cumulative&limit=2"
PHOTOS_FILE="$(mktemp)"
require_200 "$PAGE_URL" "Photo page" "$PHOTOS_FILE"
PHOTOS_PAYLOAD="$(cat "$PHOTOS_FILE")"
rm -f "$PHOTOS_FILE"
if [[ -z "$PHOTOS_PAYLOAD" ]]; then
  fail "Ingen payload fra photo/page"
fi

echo "[4/5] Assets og logger"
THUMB_URL="$(python - "$PHOTOS_PAYLOAD" <<'PY'
import json
import sys

obj = json.loads(sys.argv[1])
photos = obj.get("photos") or []
print((photos[0] or {}).get("thumbnail_url", ""))
PY
)"

if [[ -n "$THUMB_URL" ]]; then
  require_200 "$BACKEND_URL$THUMB_URL" "Photo thumbnail"
else
  echo "Advarsel: Fotoresponsen inneholder ingen thumbnail_url."
fi

require_json_field "Admin session endpoint" "$BACKEND_URL/api/v1/admin/session" "'configured' in obj and 'authenticated' in obj"

if [[ -n "$ADMIN_ACCESS_CODE" ]]; then
  COOKIE_JAR="$(new_tmp)"
  LOGIN_FILE="$(new_tmp)"
  LOGIN_PAYLOAD="$(python3 - "$ADMIN_ACCESS_CODE" <<'PY'
import json
import sys

print(json.dumps({"code": sys.argv[1]}))
PY
)"
  LOGIN_CODE="$(curl -sS -w "%{http_code}" -c "$COOKIE_JAR" -H "Content-Type: application/json" -o "$LOGIN_FILE" -d "$LOGIN_PAYLOAD" "$BACKEND_URL/api/v1/admin/login")"
  if [[ "$LOGIN_CODE" != "200" ]]; then
    fail "Admin-login feilet under smoke-check ($LOGIN_CODE)"
  fi

  LOGS_FILE="$(new_tmp)"
  LOGS_CODE="$(curl -sS -w "%{http_code}" -b "$COOKIE_JAR" -o "$LOGS_FILE" "$BACKEND_URL/api/v1/logs?limit=10")"
  if [[ "$LOGS_CODE" != "200" ]]; then
    fail "Logg endpoint feilet etter admin-login ($LOGS_CODE)"
  fi

  LOGS_COUNT="$(python3 - "$LOGS_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    payload = json.load(handle)

lines = payload.get("lines")
count = payload.get("count")
if not isinstance(lines, list):
    raise SystemExit("Mangler lines-list i logs payload")
if not isinstance(count, int):
    raise SystemExit("Mangler count-int i logs payload")
print(count)
PY
)"
  if ! [[ "$LOGS_COUNT" =~ ^[0-9]+$ ]]; then
    fail "Logger endpoint returnerte ugyldig count: $LOGS_COUNT"
  fi
else
  echo "Advarsel: ADMIN_ACCESS_CODE er ikke satt, hopper over beskyttet logs-sjekk."
fi

echo "[5/5] App side"
require_200 "$APP_URL" "Frontend" /tmp/flyv-smoke-app.html
if ! grep -qi "flyvendebønder" /tmp/flyv-smoke-app.html; then
  echo "Frontend responderer, men kunne ikke verifisere tekst i HTML."
fi

rm -f /tmp/flyv-smoke-app.html
echo "Smoke check OK."
