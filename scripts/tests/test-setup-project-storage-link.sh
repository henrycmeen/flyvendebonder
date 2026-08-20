#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SOURCE_SCRIPT="$ROOT_DIR/scripts/setup-project-storage-link.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/flyvendebonder-storage-link.XXXXXX")"
FIXTURE_ROOT="$TEST_ROOT/repo"
FIXTURE_SCRIPT="$FIXTURE_ROOT/scripts/setup-project-storage-link.sh"
TARGET_ROOT="$TEST_ROOT/target"

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
