#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR=${1:-"/Users/henmee/Movies/Droneshots/Meen gård/Analysebilder"}

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Source directory not found: $SOURCE_DIR" >&2
  exit 1
fi

TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

find "$SOURCE_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.tif" \) -print0 \
  | xargs -0 exiftool -q -q -n -j -DateTimeOriginal -GPSLatitude -GPSLongitude -Make -Model > "$TMP_JSON"

python3 - "$TMP_JSON" "$SOURCE_DIR" <<'PY'
import json
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

json_path = Path(sys.argv[1])
root = Path(sys.argv[2])

items = json.loads(json_path.read_text(encoding='utf-8'))
if not items:
    print('No image metadata found.')
    sys.exit(0)

with_gps = [i for i in items if i.get('GPSLatitude') is not None and i.get('GPSLongitude') is not None]
with_time = [i for i in items if i.get('DateTimeOriginal')]

print('Analysebilder report')
print('===================')
print(f'Total images: {len(items)}')
print(f'With GPS:     {len(with_gps)}')
print(f'With time:    {len(with_time)}')

if with_time:
    parsed = []
    for i in with_time:
        try:
            parsed.append(datetime.strptime(i['DateTimeOriginal'], '%Y:%m:%d %H:%M:%S'))
        except Exception:
            continue
    if parsed:
        print(f'Date range:   {min(parsed).date()} -> {max(parsed).date()}')

if with_gps:
    lats = [i['GPSLatitude'] for i in with_gps]
    lons = [i['GPSLongitude'] for i in with_gps]
    print(f'BBox:         lat {min(lats):.6f}..{max(lats):.6f}, lon {min(lons):.6f}..{max(lons):.6f}')

models = Counter((i.get('Make', 'Unknown'), i.get('Model', 'Unknown')) for i in items)
print('\nCamera models:')
for (make, model), count in models.most_common(5):
    print(f'  {count:4d}  {make} {model}')

by_folder = Counter()
for i in items:
    p = Path(i['SourceFile'])
    try:
        rel = p.relative_to(root)
        folder = rel.parts[0] if rel.parts else '.'
    except Exception:
        folder = p.parent.name
    by_folder[folder] += 1

print('\nTop folders:')
for folder, count in by_folder.most_common(10):
    print(f'  {count:4d}  {folder}')

by_day = Counter()
for i in with_time:
    day = i['DateTimeOriginal'].split(' ')[0].replace(':', '-')
    by_day[day] += 1

print('\nTop flight days:')
for day, count in by_day.most_common(10):
    print(f'  {count:4d}  {day}')
PY
