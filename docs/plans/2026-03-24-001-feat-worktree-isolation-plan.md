---
title: "feat: Git worktree isolation for concurrent sessions"
type: feat
status: active
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-worktree-isolation-requirements.md
---

# feat: Git worktree isolation for concurrent sessions

## Overview

When multiple `def` sessions run concurrently in the same repo, their implement phases write to the same working tree, clobbering each other's changes. This plan adds git worktree isolation: each session's implement phase operates in its own worktree on a dedicated branch, producing independently mergeable branches.

## Problem Statement / Motivation

`session.target_repo` is the single anchor for all filesystem operations — `executeActions()` resolves paths against it (`actions.ts:137`), and `agent.ts:76` uses it as the spawned process `cwd`. When two sessions implement simultaneously, both write to the same directory. Git worktrees provide native isolation without the complexity of full clones.

(see origin: `docs/brainstorms/2026-03-24-worktree-isolation-requirements.md`)

## Proposed Solution

Create a git worktree when transitioning from debate → implement. Swap `session.target_repo` to the worktree path for the implement and review phases. Clean up the worktree on session completion; the branch persists for the user to push/PR.

## Technical Approach

### Architecture

The change is surgical — `target_repo` is already the single point of control. The worktree lifecycle hooks into the existing phase transition logic in `orchestrator.ts`.

```
debate phase:  target_repo = /original/repo     (reads main checkout)
     ↓ consensus reached
implement:     target_repo = .def/worktrees/<id> (writes to isolated worktree)
review:        target_repo = .def/worktrees/<id> (reviewer reads worktree state)
     ↓ session complete
cleanup:       worktree removed, branch persists
```

### Implementation Phases

#### Phase 1: Worktree lifecycle in `src/worktree.ts` (new file)

Create a small module with three functions:

**`createWorktree(targetRepo, sessionId, topic)`**
- Resolves git toplevel via `git rev-parse --show-toplevel` (don't assume `targetRepo` is the root)
- Branch name: `def/<first-8-chars-of-uuid>-<slugified-topic>` (max 50 chars)
- Worktree path: `<gitRoot>/.def/worktrees/<sessionId>`
- Runs: `git worktree add <path> -b <branch>` from the git root
- Returns `{ worktreePath, branchName }`
- Throws clear error if not inside a git repo

**`removeWorktree(targetRepo, worktreePath)`**
- Runs: `git worktree remove <path> --force`
- Silently succeeds if already removed

**`slugifyTopic(topic)`**
- Lowercase, replace non-alphanumeric with hyphens, collapse runs, trim to 30 chars

**Files:** new `src/worktree.ts`

#### Phase 2: Orchestrator integration + session persistence

**Session interface** — add three nullable fields to `Session` and `session.json`:
- `worktree_path: string | null` — path to the active worktree (null during debate)
- `branch_name: string | null` — the branch created for this session
- `original_repo: string | null` — the original target_repo (preserved for cleanup)

**Orchestrator** — at the debate → implement transition (~line 214):

```
const { worktreePath, branchName } = await createWorktree(
  session.target_repo, session.id, session.topic
);
// Persist worktree state so recovery can restore it
await updateSession(session.dir, {
  worktree_path: worktreePath,
  branch_name: branchName,
  original_repo: session.target_repo,
});
session.target_repo = worktreePath;  // Swap the anchor
```

At session completion (~line 268, after `generateDecisions`):

```
if (session.branch_name) {
  await removeWorktree(session.original_repo, session.worktree_path);
  console.log(`  Branch:    ${session.branch_name}`);
}
```

**Shutdown handler** (`session.ts:installShutdownHandler`): if `session.worktree_path` exists, clean up worktree on SIGINT.

**Recovery** (`recovery.ts:doResume`): if `session.worktree_path` exists, restore `target_repo` to the worktree path so implement/review phases resume in the right place.

**Key details:**
- Debate phase agents read from the original `target_repo` (main checkout). Only after consensus does the swap happen (origin requirement R4).
- The worktree branches from HEAD. It does NOT include uncommitted changes from the main checkout — this is intentional. The implementing agent works from a clean snapshot.
- Planning mode never reaches the implement transition, so no worktree is created. No special guard needed.

**Files:** `src/worktree.ts` (new), `src/orchestrator.ts`, `src/session.ts`, `src/recovery.ts`

## Acceptance Criteria

- [ ] `def "topic A"` and `def "topic B"` can run simultaneously without file conflicts
- [ ] Each completed edit-mode session produces a branch `def/<id>-<topic>`
- [ ] `git worktree list` shows active worktrees during implement/review, clean after completion
- [ ] `git branch` shows the session branch after completion
- [ ] SIGINT during implement cleans up the worktree but preserves the branch
- [ ] Session recovery correctly restores `target_repo` to worktree path when resuming an implement/review session
- [ ] Planning mode sessions do not create worktrees
- [ ] CLI prints branch name on session completion
- [ ] `.def/worktrees/` is already covered by `.def/` in `.gitignore`

## System-Wide Impact

- **`actions.ts`**: No changes needed — already resolves paths against `targetRepo` parameter
- **`agent.ts`**: No changes needed — already uses `session.target_repo` as cwd
- **`context.ts`**: No changes needed — reads from `session.dir` (session metadata), not `target_repo`
- **`server.ts`**: No changes needed — serves from `session.dir`
- **`session.ts`**: Add fields to Session interface, update shutdown handler
- **`orchestrator.ts`**: Add worktree create/destroy at phase transitions
- **`recovery.ts`**: Restore target_repo from worktree_path on resume

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| `git worktree add` fails (not a git repo, dirty state) | Check `git rev-parse --is-inside-work-tree` before attempting; fail gracefully with clear error |
| Worktree not cleaned up on crash | Recovery checks for orphaned worktrees; `git worktree prune` on startup |
| Windows path length limits | Worktree path is short: `.def/worktrees/<uuid>` |
| Agent reads files from wrong directory | `target_repo` swap is the single control point — all downstream code already uses it |

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-24-worktree-isolation-requirements.md](docs/brainstorms/2026-03-24-worktree-isolation-requirements.md) — Key decisions: git worktrees over Claude worktrees, branch per session, worktree created at implement transition, debate reads main checkout

### Internal References
- `session.target_repo` usage: `orchestrator.ts:266`, `agent.ts:76`, `actions.ts:137`
- Phase transition: `orchestrator.ts:214-223`
- Session interface: `session.ts:13-30`
- Shutdown handler: `session.ts:131-155`
- Recovery resume: `recovery.ts:133-142`
