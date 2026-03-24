---
date: 2026-03-24
topic: worktree-isolation
---

# Git Worktree Isolation for Concurrent Sessions

## Problem Frame
When multiple `def` sessions run concurrently in the same repo, their implement phases write to the same working tree, clobbering each other's changes. Sessions need filesystem isolation so their implementations don't collide.

## Requirements
- R1. Each session's implement phase operates in its own git worktree, not the main checkout
- R2. Worktree is created on a new branch `def/<short-id>-<slugified-topic>` from current HEAD when the session transitions from debate to implement
- R3. All `def-action` operations (write-file, edit-file, shell, mkdir) target the worktree path during implement and review phases
- R4. Debate phase agents read from the main checkout (not the worktree) since they're analyzing the real repo state
- R5. On session completion, print the branch name and suggest push/PR. The worktree is cleaned up but the branch persists.
- R6. On session interruption (SIGINT), clean up the worktree but preserve the branch

## Success Criteria
- Two `def` sessions can run simultaneously in the same repo without file conflicts
- Each completed session produces a branch that can be pushed and PR'd independently
- `git worktree list` shows active worktrees during sessions, clean after completion

## Scope Boundaries
- No auto-push or auto-PR creation — user decides when to push
- No merge conflict resolution — worktrees branch from HEAD independently
- Debate phase is NOT isolated (reads main checkout)
- Planning mode (`--mode planning`) does not create worktrees (no implement phase)

## Key Decisions
- **Git worktrees over Claude Code worktrees**: DEF controls the subprocess lifecycle, so git's native worktree is the right primitive
- **Branch per session**: Natural PR flow, each session's work is independently reviewable
- **Worktree created at implement transition, not session start**: Debate doesn't need isolation, avoids creating worktrees for sessions that never reach consensus
- **Worktree cleanup on completion**: Prevents worktree accumulation; branch persists for the user to push

## Next Steps
→ `/ce:plan` for structured implementation planning
