---
tracker:
  kind: linear
  project_slug: "flyvendebonder-caba5c6a47de"
  active_states:
    - Todo
    - In Progress
    - Human Review
    - Merging
    - Rework
  terminal_states:
    - Done
    - Canceled
    - Duplicate
polling:
  interval_ms: 8000
workspace:
  root: ~/code/symphony-workspaces/flyvendebonder
hooks:
  after_create: |
    REPO_URL="${SYMPHONY_SOURCE_REPO_URL:-git@github.com:henrycmeen/flyvendebonder.git}"
    git clone --depth 1 "$REPO_URL" .
    ./scripts/symphony-bootstrap.sh
agent:
  max_concurrent_agents: 1
  max_turns: 8
codex:
  command: codex --config shell_environment_policy.inherit=all --config model_reasoning_effort=high app-server
  approval_policy: never
  thread_sandbox: workspace-write
  turn_sandbox_policy:
    type: workspaceWrite
---

You are working on a Linear ticket `{{ issue.identifier }}` in the Flyvendebønder repo.

Issue context:
- Identifier: `{{ issue.identifier }}`
- Title: `{{ issue.title }}`
- State: `{{ issue.state }}`
- Labels: `{{ issue.labels }}`
- URL: `{{ issue.url }}`

Description:
{% if issue.description %}
{{ issue.description }}
{% else %}
No description provided.
{% endif %}

## Core operating rules

1. This is an unattended Symphony run. Do not ask a human to do follow-up work unless there is a true blocker such as missing auth, missing secrets, or missing required Linear workflow states.
2. Work only inside the provided repository workspace.
3. One ticket equals one reviewable PR. Do not expand scope silently.
4. Use Norwegian in user-facing text, workpad notes, and PR descriptions.
5. Do not touch `apps/demo-fotokart/`, deploy scripts, GitHub live deploy workflow, or Mac mini drift unless the ticket explicitly requires it.
6. Do not merge or deploy while the ticket is in `Todo`, `In Progress`, `Human Review`, or `Rework`.
7. Pilot guard: unattended implementation work is limited to tickets labeled `Agent Safe` and not labeled `Trenger avklaring`.
8. If a ticket in `Todo` or `In Progress` fails that pilot guard, record the reason in the workpad, move the ticket back to `Backlog`, and stop without coding.
9. Do not use sub-agents during this pilot. Work directly in the current workspace instead of using `spawn_agent`, `wait`, or similar delegation patterns.

## Required repo validation

- Standard validation: `./scripts/validate-agent-worktree.sh`
- If the change affects frontend behavior, routing, or API surface: `./scripts/run-stack-smoke.sh`

## Safe first-scope areas

- `apps/web-app/`
- `apps/backend-api/app/`
- `apps/backend-api/tests/`
- `docs/`

## Areas that still require extra caution

- `scripts/deploy-flyvendebonder.sh`
- `.github/workflows/deploy-main.yml`
- backend restart and live drift on Mac mini
- changes that introduce new secrets or external services

## Symphony-specific expectations

- This workflow expects the Linear team to have the non-default statuses `Human Review`, `Merging`, and `Rework`.
- If any of those statuses are missing, document the blocker in the workpad and stop. Do not guess alternative states.
- Use one persistent Linear comment with the heading `## Codex Workpad` as the single source of truth for plan, validation, and handoff notes.
- If you discover meaningful out-of-scope work, create a new Linear issue in the same project, leave it in `Backlog`, and link the current ticket.

## State routing

- `Backlog`: do nothing.
- `Todo`: move immediately to `In Progress`, then start work.
- `In Progress`: continue planning, implementation, validation, and PR work.
- `Human Review`: wait for review outcome. If changes are requested, move to `Rework`.
- `Rework`: address review feedback, revalidate, and move back to `Human Review`.
- `Merging`: open and follow `.codex/skills/land/SKILL.md`, then move to `Done` when the PR is merged.
- `Done`: do nothing.

## Execution checklist

1. Fetch the current issue state and attachments first.
2. Find or create the single `## Codex Workpad` comment and keep it up to date throughout the run.
3. Start the workpad with:
   - a compact environment stamp `<host>:<abs-workdir>@<short-sha>`
   - `Plan`
   - `Acceptance Criteria`
   - `Validation`
   - `Notes`
   - `Confusions`
4. Run the `pull` skill before making code edits and record the result in the workpad.
5. Reproduce the current behavior or failure signal first and record concrete evidence in `Notes`.
6. Make the smallest reviewable change that satisfies the ticket.
7. Run the required validation for the changed surface.
8. Use the `commit` and `push` skills to publish the branch and PR.
9. Attach the PR URL to the Linear issue.
10. Move to `Human Review` only when validation is green and the acceptance criteria are explicitly checked off in the workpad.

## PR handling

- Use `.github/pull_request_template.md` for PR body content.
- Keep the PR title aligned with the actual shipped outcome.
- Sweep all open PR comments before moving to `Human Review`.
- Treat reviewer comments as blocking until they are fixed or explicitly pushed back with a concrete reason.

## Pilot efficiency rules

- Prefer repo-local skills under `.codex/skills/` when they exist. Do not open shared/global skill docs unless the repo-local skill is missing or the task explicitly needs broader workspace management.
- Keep branch setup short. If the issue branch does not already exist on `origin`, create it from `refs/remotes/origin/main` and continue. Do not spend more than a handful of git inspection commands proving the same thing.
- Keep initial code reconnaissance narrow: identify the likely target files plus at most one reusable comparison pattern, then move to editing or document a concrete blocker.
- Avoid broad repo-wide scans after the likely files are known.
- Update the workpad after pull/reproduction and again only when there is meaningful implementation or validation progress.

## Final message discipline

- Final session output should contain completed actions and blockers only.
- Do not include "next steps for the user" unless the run is genuinely blocked.
