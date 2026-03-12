---
name: commit
description: Create a clean git commit for the current Flyvendebønder change.
---

# Commit

## Goals

- Commit only the intended changes for the current Linear ticket.
- Keep the message aligned with the actual diff.
- Record validation that was run.

## Steps

1. Inspect `git status`, `git diff`, and `git diff --staged`.
2. Stage only the files that belong to the current ticket.
3. Stop if build artifacts, logs, or unrelated files are accidentally staged.
4. Use a conventional subject such as:
   - `feat(web-app): ...`
   - `fix(api): ...`
   - `docs(symfony): ...`
   - `refactor(metadata): ...`
5. Keep the subject imperative and under 72 characters.
6. Add a wrapped body with:
   - what changed
   - why it changed
   - what validation was run
7. Add `Co-authored-by: Codex <codex@openai.com>` unless instructed otherwise.
8. Commit with `git commit -F <file>` or a here-doc, not a single `-m` blob.

## Template

```text
<type>(<scope>): <short summary>

Summary:
- <key change>
- <key change>

Why:
- <reason>

Validation:
- <command or not run with reason>

Co-authored-by: Codex <codex@openai.com>
```
