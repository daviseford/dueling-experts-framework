---
title: "feat: Replace def-action blocks with native agent execution"
type: feat
status: active
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-native-agent-execution-requirements.md
depends: feat/worktree-isolation
---

# feat: Replace def-action blocks with native agent execution

## Overview

The implement phase currently requires agents to express changes as structured `def-action` blocks, which the orchestrator parses and executes. This is fragile. Replace it with native agent tool access: agents run with `--allowedTools "*"` during implement and make changes directly in the session's worktree. The review phase receives a `git diff` of actual changes.

## Technical Approach

### Phase 1: Agent invocation changes (`src/agent.ts`)

Make agent args phase-aware:

- **Claude debate/review:** `claude --print` (unchanged — text-only, prompt via stdin)
- **Claude implement:** `claude -p "instruction" --allowedTools "*"` (tool access, prompt piped as stdin context)
- **Codex:** no changes (already has `--full-auto` tool access for all phases)

The `-p "instruction"` flag makes Claude treat stdin as context and the flag argument as the prompt. This avoids the shell arg length limit for long assembled prompts.

### Phase 2: Diff capture (`src/worktree.ts`)

Add `captureDiff(worktreePath)` to worktree.ts:

1. Run `git add -A` to stage all changes (committed + uncommitted)
2. Run `git diff --cached HEAD` to get the full diff
3. Return the diff string (empty string if no changes)

Also add `captureDiffStat(worktreePath)` for summarized output.

### Phase 3: Orchestrator implement phase (`src/orchestrator.ts`)

Replace action parsing with diff capture:

```
// Before (current):
actions = parseActions(content)
results = executeActions(actions, targetRepo)
writeActionResults(session, turnCount, results)

// After (native execution):
diff = captureDiff(session.target_repo)
writeDiffArtifact(session, turnCount, diff)
```

- Remove `parseActions` / `executeActions` imports
- After implement agent finishes, capture diff from worktree
- Store as `artifacts/diff-NNNN.patch`
- If diff is empty, retry (agent didn't make changes)
- Transition to review with diff as context

### Phase 4: Context assembly changes (`src/context.ts`)

**Implement prompt:**
- Remove action format instructions
- Tell agent it has full tool access to read, write, edit files, and run commands
- Tell agent working directory is the project root
- Still require frontmatter in text output (for turn tracking)

**Review prompt:**
- Replace action results with git diff
- Load diff from `artifacts/diff-NNNN.patch` instead of `action-results-NNNN.json`
- If diff exceeds 50K chars (~12.5K tokens), show stat summary + truncated diff

### Phase 5: Remove actions.ts

- Delete `src/actions.ts`
- Delete `src/__tests__/actions.test.ts`
- Remove all action-related imports and types from orchestrator.ts and context.ts

## Acceptance Criteria

- [ ] Implement phase produces real file changes in worktree without action block parsing
- [ ] Reviewer sees actual git diff, not action block descriptions
- [ ] No more "No def-action blocks found" errors during implement
- [ ] `actions.ts` deleted, no action-related code remains
- [ ] Tests pass, typecheck clean
- [ ] Review prompt handles large diffs gracefully (stat summary + truncation)
