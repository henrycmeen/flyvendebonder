#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=13
EXPECTED_PYTHON_MAJOR=3
EXPECTED_PYTHON_MINOR=13
MIN_FREE_GIB="${MIN_FREE_GIB:-30}"
FAILURES=0
WARNINGS=0

pass() {
  printf 'PASS %s\n' "$1"
}

warn() {
  printf 'WARN %s\n' "$1"
  WARNINGS=$((WARNINGS + 1))
}

fail() {
  printf 'FAIL %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

command_path() {
  command -v "$1" 2>/dev/null || true
}

check_command() {
  local name="$1"
  if [[ -n "$(command_path "$name")" ]]; then
    pass "$name finnes"
  else
    fail "$name mangler"
  fi
}

echo "Flyvendebønder doctor"
echo "Repo: $ROOT_DIR"

for command_name in git curl rsync node npm; do
  check_command "$command_name"
done

if [[ -n "$(command_path node)" ]]; then
  NODE_VERSION="$(node --version | sed 's/^v//')"
  IFS=. read -r NODE_MAJOR NODE_MINOR _ <<<"$NODE_VERSION"
  if ((NODE_MAJOR == MIN_NODE_MAJOR && NODE_MINOR >= MIN_NODE_MINOR)); then
    pass "Node $NODE_VERSION matcher repoets minimum"
  else
    warn "Node $NODE_VERSION er aktiv; repoet forventer minst $MIN_NODE_MAJOR.$MIN_NODE_MINOR"
  fi
fi

PYTHON_BIN=""
if [[ -x "$ROOT_DIR/apps/backend-api/.venv/bin/python" ]]; then
  PYTHON_BIN="$ROOT_DIR/apps/backend-api/.venv/bin/python"
elif [[ -n "$(command_path python3.13)" ]]; then
  PYTHON_BIN="$(command_path python3.13)"
elif [[ -n "$(command_path python3)" ]]; then
  PYTHON_BIN="$(command_path python3)"
fi

if [[ -z "$PYTHON_BIN" ]]; then
  fail "Python mangler"
else
  PYTHON_VERSION="$($PYTHON_BIN -c 'import platform; print(platform.python_version())')"
  PYTHON_LINE="$($PYTHON_BIN -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
  if [[ "$PYTHON_LINE" == "$EXPECTED_PYTHON_MAJOR.$EXPECTED_PYTHON_MINOR" ]]; then
    pass "Python $PYTHON_VERSION matcher .python-version"
  else
    warn "Python $PYTHON_VERSION er aktiv; backend forventer $EXPECTED_PYTHON_MAJOR.$EXPECTED_PYTHON_MINOR"
  fi
fi

if git -C "$ROOT_DIR" diff --quiet && git -C "$ROOT_DIR" diff --cached --quiet; then
  pass "Ingen endringer i sporede filer"
else
  warn "Arbeidskopien har endringer i sporede filer"
fi

UNTRACKED_COUNT="$(git -C "$ROOT_DIR" ls-files --others --exclude-standard | wc -l | tr -d ' ')"
if [[ "$UNTRACKED_COUNT" == "0" ]]; then
  pass "Ingen untracked filer"
else
  warn "$UNTRACKED_COUNT untracked filer"
fi

FREE_KIB="$(df -Pk "$ROOT_DIR" | awk 'NR == 2 {print $4}')"
FREE_GIB="$((FREE_KIB / 1024 / 1024))"
if ((FREE_GIB >= MIN_FREE_GIB)); then
  pass "Diskplass ${FREE_GIB} GiB"
else
  warn "Kun ${FREE_GIB} GiB ledig; anbefalt minimum er ${MIN_FREE_GIB} GiB før tunge bygg"
fi

if [[ -n "$(command_path gh)" ]]; then
  if gh auth status --hostname github.com >/dev/null 2>&1; then
    pass "GitHub CLI er innlogget"
  else
    warn "GitHub CLI er ikke innlogget"
  fi
fi

echo "Resultat: $FAILURES feil, $WARNINGS varsler"
if ((FAILURES > 0)); then
  exit 1
fi
