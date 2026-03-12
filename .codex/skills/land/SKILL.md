---
name: land
description: Merge a validated Flyvendebønder PR when the Linear ticket is in Merging.
---

# Land

## Goals

- Merge only when the PR is green and reviewer feedback is handled.
- Resolve merge conflicts safely if `origin/main` has moved.
- Leave the issue ready for `Done`.

## Preconditions

- `gh` is authenticated.
- The current branch has an open PR.
- The Linear issue is already in `Merging`.

## Steps

1. Find the PR for the current branch:
   - `gh pr view --json number,title,body,mergeable,url`
2. If the working tree is dirty, use the `commit` skill and then the `push` skill first.
3. If the PR is conflicting, run the `pull` skill, then the `push` skill.
4. Sweep all open PR comments and review threads. Do not merge while actionable comments remain unresolved.
5. Wait for checks to finish:
   - `gh pr checks --watch`
6. If checks fail, inspect logs, fix the issue, revalidate, commit, push, and watch again.
7. When checks are green and feedback is resolved, squash-merge:
   - `gh pr merge --squash --subject "$PR_TITLE" --body "$PR_BODY"`
8. Record merge result in the Linear workpad and move the ticket to `Done`.

## Notes

- Do not enable auto-merge for this repo.
- Use the PR title/body as merge subject/body unless a reviewer explicitly requests something else.
