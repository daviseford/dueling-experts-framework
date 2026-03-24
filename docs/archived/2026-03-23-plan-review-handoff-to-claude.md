---
date: 2026-03-23
topic: plan-review-handoff-to-claude
source: codex
related:
  - docs/plans/2026-03-23-001-feat-agent-collaboration-hybrid-handoff-plan.md
  - .claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md
---

# Handoff to Claude: Plan Review Concerns

Please review and correct the current implementation plan:

- `docs/plans/2026-03-23-001-feat-agent-collaboration-hybrid-handoff-plan.md`

I found four plan issues that should be resolved before implementation.

## 1. Paused-session interjection deadlock

### Problem

The plan currently says:

- human interjections always queue
- the interjection queue only drains at `TURN_BOUNDARY`
- a `needs_human` pause is resumed by human input

That combination deadlocks the paused state. If the session is paused waiting for human input, and the only human input path still queues behind `TURN_BOUNDARY`, the orchestrator never reaches the boundary needed to resume.

### What needs to change

Please define a direct paused-session resume path.

Recommended direction:

- normal unsolicited human interjections may queue for the next turn boundary
- but when session state is `PAUSED` and the orchestrator is explicitly waiting for a human response, `POST /api/interject` should bypass the normal queue and directly resolve the paused wait
- that resumed human response should be persisted as the next canonical turn before control returns to the waiting agent

## 2. Claude project-doc contamination

### Problem

The plan appears to assume the orchestrator fully controls Claude's turn prompt. That is not safe if `claude` is invoked from a target repo containing its own `CLAUDE.md` or similar project instructions. Those repo-level instructions can leak into the collaboration session and conflict with the required output format and role prompt.

Codex already has explicit instruction-isolation handling via per-session runtime files. Claude needs an equivalent mitigation.

### What needs to change

Please define how Claude invocation avoids target-repo prompt contamination.

Recommended direction:

- do not invoke `claude` from the target repo root if that allows project docs to be merged implicitly
- use an isolated session working directory or an explicit suppression strategy
- preserve access to target repo files as reference material without inheriting repo-specific collaboration instructions

## 3. Crash recovery misclassifies `status: complete`

### Problem

The plan appears to treat `status: complete` as evidence that a session is finished during recovery. That is incorrect. `complete` is the normal per-turn status for an active session.

If recovery logic scans for directories that lack a special marker beyond seeing `complete`, it can incorrectly skip active sessions after the first successful turn.

### What needs to change

Please define a session-level recovery rule that does not confuse per-turn completion with session completion.

Recommended direction:

- session completion should be determined by session state, explicit session artifact, or last canonical turn with `status: done`
- do not treat any ordinary `complete` turn as proof that the whole session is finished
- recovery should inspect the last canonical turn plus session metadata, not just grep for `complete`

## 4. Post-`DONE` reopening is underspecified

### Problem

The plan says a human can interject after both agents agree on `done` and the session will reopen, but the state machine appears to end at `COMPLETING -> DONE` with no defined transition back out.

That means the plan currently promises reopen behavior without defining:

- the state transition
- whether artifacts are regenerated
- whether new turns append to the existing session or fork a new one

### What needs to change

Please either:

- forbid post-completion reopen behavior in v1

or

- define an explicit reopen path with clear state transitions and artifact regeneration semantics

Recommended direction:

- simplest v1 choice is to forbid reopening after `DONE`
- if Davis wants to continue, create a new session seeded from the previous session's summary or artifacts

## Requested Claude Output

Please return:

1. A decision on each of the four concerns above
2. Proposed edits to the plan's state machine and recovery rules
3. Whether post-`DONE` reopening should be removed from v1 or fully specified
4. Any plan text that should be updated to keep the plan consistent with the locked requirements doc

## Codex Position

My preference is:

- direct resume path for paused human responses
- explicit Claude instruction-isolation strategy
- session-level recovery markers, not turn-level `complete`
- remove post-`DONE` reopen from v1 unless you want to fully specify it now
