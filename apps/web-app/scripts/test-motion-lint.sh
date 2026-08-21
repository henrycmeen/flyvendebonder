#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOTION_LINT="$SCRIPT_DIR/motion-lint.sh"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$TEMP_DIR/allowed/src" "$TEMP_DIR/forbidden/src" "$TEMP_DIR/forbidden-linear/src" "$TEMP_DIR/no-rg-bin" "$TEMP_DIR/empty-bin" "$TEMP_DIR/outside"
printf '%s\n' '.button { transition: color 150ms ease; }' '.curve { transition: color var(--linearized-ease); }' '.gradient { background: linear-gradient(red, blue); transition: opacity 150ms ease; }' > "$TEMP_DIR/allowed/src/styles.css"
printf '%s\n' 'export const className = "transition-all";' > "$TEMP_DIR/forbidden/src/example.ts"
printf '.button { transition:\tcolor 150ms linear; }\n' > "$TEMP_DIR/forbidden-linear/src/styles.css"
printf '%s\n' 'export const className = "transition-all";' > "$TEMP_DIR/outside/forbidden.ts"
ln -s "$TEMP_DIR/outside" "$TEMP_DIR/allowed/src/external-link"
ln -s "$(command -v grep)" "$TEMP_DIR/no-rg-bin/grep"

missing_output="$TEMP_DIR/missing-rg.log"
if ! (cd "$TEMP_DIR/allowed" && PATH="$TEMP_DIR/no-rg-bin" /bin/bash "$MOTION_LINT") >"$missing_output" 2>&1; then
  echo "motion-lint test: allowed code should pass without rg" >&2
  cat "$missing_output" >&2
  exit 1
fi
if grep -q "command not found" "$missing_output"; then
  echo "motion-lint test: missing rg must not cause a command error" >&2
  cat "$missing_output" >&2
  exit 1
fi

missing_grep_output="$TEMP_DIR/missing-grep.log"
if (cd "$TEMP_DIR/allowed" && PATH="$TEMP_DIR/empty-bin" /bin/bash "$MOTION_LINT") >"$missing_grep_output" 2>&1; then
  echo "motion-lint test: missing grep should fail" >&2
  cat "$missing_grep_output" >&2
  exit 1
fi
if ! grep -q "grep.*mangler\|mangler.*grep" "$missing_grep_output"; then
  echo "motion-lint test: expected a clear missing-grep error" >&2
  cat "$missing_grep_output" >&2
  exit 1
fi

test_path="/usr/bin:/bin"

if ! (cd "$TEMP_DIR/allowed" && PATH="$test_path" /bin/bash "$MOTION_LINT"); then
  echo "motion-lint test: allowed code should pass" >&2
  exit 1
fi

forbidden_output="$TEMP_DIR/forbidden-pattern.log"
if (cd "$TEMP_DIR/forbidden" && PATH="$test_path" /bin/bash "$MOTION_LINT") >"$forbidden_output" 2>&1; then
  echo "motion-lint test: transition-all should fail" >&2
  cat "$forbidden_output" >&2
  exit 1
fi
if ! grep -q "transition-all" "$forbidden_output"; then
  echo "motion-lint test: expected transition-all diagnostic" >&2
  cat "$forbidden_output" >&2
  exit 1
fi

linear_output="$TEMP_DIR/forbidden-linear.log"
if (cd "$TEMP_DIR/forbidden-linear" && PATH="$test_path" /bin/bash "$MOTION_LINT") >"$linear_output" 2>&1; then
  echo "motion-lint test: linear transition should fail" >&2
  cat "$linear_output" >&2
  exit 1
fi
if ! grep -q "linear.*transition\|transition.*linear" "$linear_output"; then
  echo "motion-lint test: expected linear-transition diagnostic" >&2
  cat "$linear_output" >&2
  exit 1
fi

echo "motion-lint tests passed"
