---
name: push
description: Push current Flyvendebønder branch and create or update the corresponding PR.
---

# Push

## Goals

- Push current branch safely to `origin`.
- Ensure a PR exists and matches the actual scope.
- Keep validation green before publish.

## Steps

1. Identify the current branch with `git branch --show-current`.
2. Run required validation from the ticket/workpad:
   - always `./scripts/validate-agent-worktree.sh`
   - additionally `./scripts/run-stack-smoke.sh` if frontend behavior, routing, or API surface changed
3. Push branch to `origin`:
   - `git push -u origin HEAD`
4. If push is rejected because the branch is stale, run the `pull` skill, revalidate, and push again.
5. If a PR does not exist, create one.
6. If a PR exists, update its title/body so they reflect the full current scope.
7. Use `.github/pull_request_template.md` for the PR body.
8. If the `symphony` GitHub label exists, ensure the PR has it.
9. Reply with the PR URL and attach it to the Linear issue.

## Notes

- Do not switch remotes or auth mode as a workaround for permission failures. Surface the real error.
- Do not use `--force`; use `--force-with-lease` only if history was intentionally rewritten.
