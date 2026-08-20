#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LINK_PATH="$ROOT_DIR/project-storage"
PROJECTS_MOUNT="/Volumes/Projects"
DEFAULT_TARGET="/Volumes/Projects/Active/Flyvendebonder"
TARGET_PATH="${1:-$DEFAULT_TARGET}"

if [[ "$TARGET_PATH" == "--help" || "$TARGET_PATH" == "-h" ]]; then
  echo "Usage: $0 [storage-path]"
  echo "Default storage path: $DEFAULT_TARGET"
  exit 0
fi

if [[ ! -d "$TARGET_PATH" ]]; then
  echo "Project storage is unavailable: $TARGET_PATH" >&2
  echo "Mount the Projects disk, or pass the correct storage path explicitly." >&2
  exit 1
fi

TARGET_PATH="$(cd "$TARGET_PATH" && pwd -P)"

if [[ "$TARGET_PATH" == "$DEFAULT_TARGET" ]]; then
  MOUNT_ROOT="$(/bin/df -P "$PROJECTS_MOUNT" 2>/dev/null | /usr/bin/awk 'NR == 2 { print $6 }')"
  if [[ "$MOUNT_ROOT" != "$PROJECTS_MOUNT" ]]; then
    echo "Projects volume is not mounted at $PROJECTS_MOUNT" >&2
    echo "Refusing to link the default target through a stale local directory." >&2
    exit 1
  fi
fi

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
