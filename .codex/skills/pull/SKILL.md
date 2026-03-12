---
name: pull
description: Sync current Flyvendebønder branch with origin/main using a merge flow.
---

# Pull

## Goals

- Bring the current branch up to date with `origin/main`.
- Resolve conflicts carefully.
- Re-run repo validation after merge.

## Steps

1. Ensure the working tree is clean or commit current work first.
2. Enable rerere:
   - `git config rerere.enabled true`
   - `git config rerere.autoupdate true`
3. Fetch latest refs:
   - `git fetch origin`
4. Fast-forward the current branch from remote if needed:
   - `git pull --ff-only origin $(git branch --show-current)`
5. Merge `origin/main` into the current branch:
   - `git -c merge.conflictstyle=zdiff3 merge origin/main`
6. Resolve conflicts one file at a time and preserve intent on both sides.
7. After merge, run `./scripts/validate-agent-worktree.sh`.
8. If the merged change affects frontend behavior, routing, or API surface, also run `./scripts/run-stack-smoke.sh`.
9. Summarize the merge outcome and validation in the Linear workpad.

## Notes

- Use `--force-with-lease` only later if a rewritten branch truly requires it.
- Ask for human input only if the merge conflict changes product behavior and code/tests give no safe answer.
