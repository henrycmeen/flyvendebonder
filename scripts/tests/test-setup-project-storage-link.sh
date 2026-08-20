#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_SCRIPT="$ROOT_DIR/scripts/setup-project-storage-link.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/flyvendebonder-storage-link.XXXXXX")"
FIXTURE_ROOT="$TEST_ROOT/repo"
FIXTURE_SCRIPT="$FIXTURE_ROOT/scripts/setup-project-storage-link.sh"
TARGET_ROOT="$TEST_ROOT/target"
PROJECTS_MOUNT="$TEST_ROOT/Projects"
DEFAULT_TARGET="$PROJECTS_MOUNT/Active/Flyvendebonder"
FAKE_DISKUTIL="$TEST_ROOT/diskutil"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FIXTURE_ROOT/scripts" "$TARGET_ROOT" "$TEST_ROOT/other"
cp "$SOURCE_SCRIPT" "$FIXTURE_SCRIPT"
chmod +x "$FIXTURE_SCRIPT"

expect_failure() {
  if "$@" >/dev/null 2>&1; then
    echo "Expected command to fail: $*" >&2
    exit 1
  fi
}

expect_failure "$FIXTURE_SCRIPT" "$TEST_ROOT/missing"

mkdir -p "$(dirname "$DEFAULT_TARGET")"
ln -s "$TARGET_ROOT" "$DEFAULT_TARGET"
expect_failure env \
  FLYVENDEBONDER_PROJECTS_MOUNT="$PROJECTS_MOUNT" \
  FLYVENDEBONDER_DEFAULT_STORAGE_TARGET="$DEFAULT_TARGET" \
  "$FIXTURE_SCRIPT"
unlink "$DEFAULT_TARGET"
mkdir "$DEFAULT_TARGET"

cat >"$FAKE_DISKUTIL" <<EOF
#!/usr/bin/env bash
cat <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>VolumeName</key><string>WrongVolume</string>
<key>MountPoint</key><string>$PROJECTS_MOUNT</string>
<key>FilesystemType</key><string>apfs</string>
</dict></plist>
PLIST
EOF
chmod +x "$FAKE_DISKUTIL"
expect_failure env \
  FLYVENDEBONDER_PROJECTS_MOUNT="$PROJECTS_MOUNT" \
  FLYVENDEBONDER_DEFAULT_STORAGE_TARGET="$DEFAULT_TARGET" \
  FLYVENDEBONDER_DISKUTIL_BIN="$FAKE_DISKUTIL" \
  "$FIXTURE_SCRIPT"

sed -i '' 's/WrongVolume/Projects/' "$FAKE_DISKUTIL"
env \
  FLYVENDEBONDER_PROJECTS_MOUNT="$PROJECTS_MOUNT" \
  FLYVENDEBONDER_DEFAULT_STORAGE_TARGET="$DEFAULT_TARGET" \
  FLYVENDEBONDER_DISKUTIL_BIN="$FAKE_DISKUTIL" \
  "$FIXTURE_SCRIPT" >/dev/null
[[ "$(readlink "$FIXTURE_ROOT/project-storage")" == "$DEFAULT_TARGET" ]]
unlink "$FIXTURE_ROOT/project-storage"

(
  cd "$TEST_ROOT"
  "$FIXTURE_SCRIPT" target >/dev/null
)
EXPECTED_TARGET="$(cd "$TARGET_ROOT" && pwd -P)"
[[ -L "$FIXTURE_ROOT/project-storage" ]]
[[ "$(readlink "$FIXTURE_ROOT/project-storage")" == "$EXPECTED_TARGET" ]]
"$FIXTURE_SCRIPT" "$TARGET_ROOT" >/dev/null

unlink "$FIXTURE_ROOT/project-storage"
touch "$FIXTURE_ROOT/project-storage"
expect_failure "$FIXTURE_SCRIPT" "$TARGET_ROOT"
rm "$FIXTURE_ROOT/project-storage"

mkdir "$FIXTURE_ROOT/project-storage"
expect_failure "$FIXTURE_SCRIPT" "$TARGET_ROOT"
rmdir "$FIXTURE_ROOT/project-storage"

ln -s "$TEST_ROOT/other" "$FIXTURE_ROOT/project-storage"
expect_failure "$FIXTURE_SCRIPT" "$TARGET_ROOT"
unlink "$FIXTURE_ROOT/project-storage"

ln -s "$TEST_ROOT/missing-link-target" "$FIXTURE_ROOT/project-storage"
expect_failure "$FIXTURE_SCRIPT" "$TARGET_ROOT"

echo "Project storage link tests OK."
