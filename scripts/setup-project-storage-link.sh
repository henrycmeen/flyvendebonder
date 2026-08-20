#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK_PATH="$ROOT_DIR/project-storage"
PROJECTS_MOUNT="${FLYVENDEBONDER_PROJECTS_MOUNT:-/Volumes/Projects}"
DEFAULT_TARGET="${FLYVENDEBONDER_DEFAULT_STORAGE_TARGET:-$PROJECTS_MOUNT/Active/Flyvendebonder}"
EXPECTED_VOLUME_NAME="${FLYVENDEBONDER_PROJECTS_VOLUME_NAME:-Projects}"
DISKUTIL_BIN="${FLYVENDEBONDER_DISKUTIL_BIN:-/usr/sbin/diskutil}"
PLUTIL_BIN="${FLYVENDEBONDER_PLUTIL_BIN:-/usr/bin/plutil}"
TARGET_PATH="${1:-$DEFAULT_TARGET}"

if [[ "$TARGET_PATH" == "--help" || "$TARGET_PATH" == "-h" ]]; then
  echo "Usage: $0 [storage-path]"
  echo "Default storage path: $DEFAULT_TARGET"
  exit 0
fi

if [[ "$TARGET_PATH" == "$DEFAULT_TARGET" ]]; then
  if [[ -L "$TARGET_PATH" ]]; then
    echo "Default project storage target must not be a symlink: $TARGET_PATH" >&2
    exit 1
  fi

  VOLUME_INFO="$($DISKUTIL_BIN info -plist "$PROJECTS_MOUNT" 2>/dev/null || true)"
  VOLUME_NAME="$($PLUTIL_BIN -extract VolumeName raw -o - - <<<"$VOLUME_INFO" 2>/dev/null || true)"
  MOUNT_POINT="$($PLUTIL_BIN -extract MountPoint raw -o - - <<<"$VOLUME_INFO" 2>/dev/null || true)"
  FILESYSTEM_TYPE="$($PLUTIL_BIN -extract FilesystemType raw -o - - <<<"$VOLUME_INFO" 2>/dev/null || true)"
  if [[ "$VOLUME_NAME" != "$EXPECTED_VOLUME_NAME" || "$MOUNT_POINT" != "$PROJECTS_MOUNT" || "$FILESYSTEM_TYPE" != "apfs" ]]; then
    echo "Expected APFS volume '$EXPECTED_VOLUME_NAME' is not mounted at $PROJECTS_MOUNT" >&2
    echo "Refusing to link the default target through an unverified or stale local path." >&2
    exit 1
  fi
fi

if [[ ! -d "$TARGET_PATH" ]]; then
  echo "Project storage is unavailable: $TARGET_PATH" >&2
  echo "Mount the Projects disk, or pass the correct storage path explicitly." >&2
  exit 1
fi

TARGET_PATH="$(cd "$TARGET_PATH" && pwd -P)"

if [[ -L "$LINK_PATH" ]]; then
  CURRENT_TARGET="$(readlink "$LINK_PATH")"
  if [[ "$CURRENT_TARGET" == "$TARGET_PATH" ]]; then
    echo "Project storage link is already configured: $LINK_PATH -> $TARGET_PATH"
    exit 0
  fi

  echo "Refusing to replace existing link: $LINK_PATH -> $CURRENT_TARGET" >&2
  echo "Remove it manually after verifying both paths, then run this script again." >&2
  exit 1
fi

if [[ -e "$LINK_PATH" ]]; then
  echo "Refusing to replace existing path: $LINK_PATH" >&2
  exit 1
fi

ln -s "$TARGET_PATH" "$LINK_PATH"
echo "Created project storage link: $LINK_PATH -> $TARGET_PATH"
