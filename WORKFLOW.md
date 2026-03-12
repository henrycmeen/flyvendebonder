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
    REPO_REF="${SYMPHONY_SOURCE_REPO_REF:-main}"
    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" .
    ./scripts/symphony-bootstrap.sh
agent:
  max_concurrent_agents: 1
  max_turns: 8
codex:
  command: codex --model gpt-5.3-codex-spark --config shell_environment_policy.inherit=all --config model_reasoning_effort=medium app-server
  approval_policy: never
  turn_timeout_ms: 1200000
  stall_timeout_ms: 180000
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
9. For tickets labeled `Feature`, you may use at most one explorer-style sub-agent before editing if file ownership or API shape is unclear after one quick local scan. Keep the sub-agent read-only if the tool supports it. Do not use parallel write agents, and do not spawn sub-agents after code edits begin.
10. Do not spend long turns proving the same thing twice. After one narrow upstream check or one failing environment check, either proceed to code or stop with a concrete blocker.

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
- If `origin/main` already contains the ticket outcome, record concrete evidence in the workpad, move the ticket to `Done`, and stop without opening a PR.
- If required validation is blocked by sandbox, localhost, port binding, auth, or another limitation that cannot be fixed inside the repo, record the exact failing command once, create or link one blocker issue, move the current ticket back to `Backlog`, and stop.
- If code diff and repo validation are green but GitHub publication is blocked by tooling or auth, attach compare evidence plus patch/bundle to the ticket, move to `Human Review`, and stop.

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
5. Fetch current upstream once with `git fetch origin main --depth=1` before deeper analysis.
6. If the ticket already appears to be solved, verify that once against `origin/main`. If no ticket-specific diff remains, document the evidence, move to `Done`, and stop.
7. Reproduce the current behavior or failure signal first and record concrete evidence in `Notes`.
8. Make the smallest reviewable change that satisfies the ticket.
9. Run the required validation for the changed surface.
10. Use the `commit` and `push` skills to publish the branch and PR.
11. Attach the PR URL to the Linear issue.
12. Move to `Human Review` only when validation is green and the acceptance criteria are explicitly checked off in the workpad.

## PR handling

- Use `.github/pull_request_template.md` for PR body content.
- Keep the PR title aligned with the actual shipped outcome.
- Sweep all open PR comments before moving to `Human Review`.
- Treat reviewer comments as blocking until they are fixed or explicitly pushed back with a concrete reason.

## Pilot efficiency rules

- Prefer repo-local skills under `.codex/skills/` when they exist. Do not open shared/global skill docs unless the repo-local skill is missing or the task explicitly needs broader workspace management.
- Keep branch setup short. If the issue branch does not already exist on `origin`, create it from `refs/remotes/origin/main` and continue. Do not spend more than a handful of git inspection commands proving the same thing.
- Keep initial code reconnaissance narrow: identify the likely target files plus at most one reusable comparison pattern, then move to editing or document a concrete blocker.
- Only use a sub-agent when the likely files are still unclear after one quick local scan. Use it for one bounded exploration task, then return to the main agent for implementation.
- Avoid broad repo-wide scans after the likely files are known.
- Do not spend more than one short verification loop on stale branch state or upstream divergence. If the ticket is already solved upstream or blocked outside the repo, conclude and stop.
- Update the workpad after pull/reproduction and again only when there is meaningful implementation or validation progress.

## Final message discipline

- Final session output should contain completed actions and blockers only.
- Do not include "next steps for the user" unless the run is genuinely blocked.
