#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8787}"
APP_URL="${APP_URL:-http://127.0.0.1:5173/app/}"

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

  local result
  result="$(python - "$url" "$expression" <<'PY'
import json
import sys
import urllib.request
import urllib.error

url, expr = sys.argv[1], sys.argv[2]
try:
    with urllib.request.urlopen(url, timeout=10) as response:
        payload = json.load(response)
except urllib.error.HTTPError as exc:
    raise SystemExit(f"HTTP {exc.code} from {url}")
except Exception as exc:
    raise SystemExit(str(exc))

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

  python - "$url" "$expression" <<'PY'
import json
import sys
import urllib.request
import urllib.error

url, expr = sys.argv[1], sys.argv[2]
try:
    with urllib.request.urlopen(url, timeout=10) as response:
        payload = json.load(response)
except urllib.error.HTTPError as exc:
    raise SystemExit(f"HTTP {exc.code} from {url}")
except Exception as exc:
    raise SystemExit(str(exc))

print(eval(expr, {"obj": payload}))
PY
}

echo "[1/5] Backend health"
require_json_field "Health payload" "$BACKEND_URL/api/v1/health" "obj.get('status') == 'ok'"

echo "[2/5] Profile og timeline"
require_json_field "Profile payload" "$BACKEND_URL/api/v1/profile/current" "obj.get('user', {}).get('full_name') == 'Roar Meen'"
require_json_field "Timeline payload" "$BACKEND_URL/api/v1/timeline/dates" "len(obj.get('dates', [])) >= 1"

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

require_json_field "Logg endpoint" "$BACKEND_URL/api/v1/logs?limit=10" "'lines' in obj and isinstance(obj.get('lines'), list)"
LOGS_COUNT="$(extract_json_field "$BACKEND_URL/api/v1/logs?limit=10" "obj.get('count')")"
if ! [[ "$LOGS_COUNT" =~ ^[0-9]+$ ]]; then
  fail "Logger endpoint returnerte ugyldig count: $LOGS_COUNT"
fi

echo "[5/5] App side"
require_200 "$APP_URL" "Frontend" /tmp/flyv-smoke-app.html
if ! grep -qi "flyvendebønder" /tmp/flyv-smoke-app.html; then
  echo "Frontend responderer, men kunne ikke verifisere tekst i HTML."
fi

rm -f /tmp/flyv-smoke-app.html
echo "Smoke check OK."
