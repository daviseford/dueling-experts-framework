---
date: 2026-03-24
topic: native-agent-execution
---

# Replace def-action Blocks with Native Agent Execution

## Problem Frame
The implement phase currently requires agents to express file changes as structured `def-action` blocks in their text output. This is fragile — agents forget the format, ask for permissions they can't have, or write prose instead of action blocks. Meanwhile, both Claude Code and Codex already have native file-writing capabilities that are more reliable.

## Requirements
- R1. During the implement phase, agents run with full tool access (not `--print` mode), executing directly in the session's worktree
- R2. Claude is invoked as `claude` (interactive CLI, not `--print`) during implement. Codex continues as `codex exec --full-auto`.
- R3. After the implementing agent finishes, the orchestrator captures a `git diff` from the worktree to record what changed
- R4. The review phase receives the git diff as context — both reviewing agents assess the actual changes, not action block descriptions (see `2026-03-24-phase-model-restructuring-requirements.md` R5 for collaborative review mechanics)
- R5. Remove `def-action` block parsing (`actions.ts`) and the implement prompt's action format instructions
- R6. Plan and review phases continue using `--print` mode (text-only, no tool access) — only implement changes (note: "debate" renamed to "plan" per `2026-03-24-phase-model-restructuring-requirements.md` R1)

## Success Criteria
- Implement phase produces real file changes in the worktree without action block parsing failures
- Reviewer sees a real git diff, not a description of intended changes
- No more "No def-action blocks found" or "agent asked for permissions" errors during implement

## Scope Boundaries
- Depends on worktree isolation (see `docs/brainstorms/2026-03-24-worktree-isolation-requirements.md`) — implement must run in an isolated worktree, not the main checkout
- No restrictions on what the agent does in the worktree (full handoff)
- Review phase stays in `--print` mode — reviewer produces text feedback, not code
- `actions.ts` can be deleted entirely once this ships

## Key Decisions
- **Full handoff over sandboxed**: No filtering of agent operations during implement. The worktree is disposable — if the agent does something destructive, the branch can be discarded.
- **Git diff for review input**: Unified diff is the most precise representation of what changed. Full file contents would bloat the prompt.
- **Claude interactive CLI for implement**: `claude` without `--print` gives full tool access. Simpler than managing sessions or continuation.
- **`--print` stays for plan/review**: These phases produce structured text (frontmatter + markdown). Full tool access would add complexity with no benefit.

## Dependencies / Assumptions
- Worktree isolation must be implemented first (R1 depends on having a dedicated worktree per session)
- Claude CLI supports non-interactive invocation with a prompt (piped to stdin) while retaining tool access
- The worktree is a valid git repo with a clean state at implement start

## Outstanding Questions

### Deferred to Planning
- [Affects R2][Needs research] How does `claude` (without `--print`) behave when prompt is piped to stdin? Does it still use tools, or does it fall back to print mode?
- [Affects R3][Technical] Should the git diff be stored as an artifact (`artifacts/diff-NNNN.patch`) for later reference?
- [Affects R4][Technical] If the diff is too large for the review prompt's context budget, how should it be truncated?

## Next Steps
→ `/ce:plan` for structured implementation planning (after worktree isolation is implemented)
