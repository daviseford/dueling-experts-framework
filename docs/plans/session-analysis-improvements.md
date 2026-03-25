# Session Analysis Improvements

Issues identified from analyzing sessions 39753326 and a0c5f8e9 (2026-03-25).

## 1. Codex Windows Sandbox Failures

**Problem:** Codex hit `CreateProcessWithLogonW failed: 1056` when trying to inspect code during plan/review phases on Windows. It continued without direct code access, relying on the other agent's descriptions.

**Impact:** Codex can't independently verify code claims, reducing adversarial value.

**Proposed fix:** The `reviewArgs` change (`--sandbox read-only`) should address this — Codex now gets explicit read-only sandbox instead of `--full-auto` in plan/review. If sandbox errors persist, investigate:
- Whether `read-only` sandbox avoids the Windows `CreateProcessWithLogonW` path entirely
- Whether `--sandbox read-only` still triggers Windows sandboxing for shell commands
- Fallback: pass `--dangerously-bypass-approvals-and-sandbox` for plan/review if read-only sandbox is broken on Windows

**Validation:** Run a DEF session with `--impl-model codex` and check Codex plan/review logs for sandbox errors.

## 2. Claude Doesn't Probe API Constraints Before Acting

**Problem:** In the PR review session, Claude posted all reviews as COMMENTED state, then discovered mid-implementation that GitHub API returns 422 for REQUEST_CHANGES/APPROVE on self-authored PRs. This wasted a full implementation turn.

**Impact:** Implementation turns are expensive (900s timeout, full tool access). Discovering constraints during implementation means wasted work and fix cycles.

**Proposed fix:** Add a "probe constraints" instruction to the implement prompt in `src/context.ts`. When the implementation involves external APIs (GitHub, npm, etc.), the agent should:
1. Test a minimal API call first to verify capabilities
2. Document any constraints discovered
3. Adapt the implementation plan before bulk execution

This could be a general instruction added to `implementPrompt()`:
```
Before executing bulk operations against external APIs, probe a single call first
to verify the expected behavior works. Document any constraints you discover.
```

**Files:** `src/context.ts` — `implementPrompt()` function

## 3. No Planning-Only Mode Detection

**Problem:** The PR review session used `edit` mode, which created a worktree and branch with no code changes. The topic ("run PR reviews of all open PRs") was inherently a planning/action task, not a code edit task. The session ended with `pr_url: null` because there were no code changes to PR.

**Impact:** Unnecessary worktree creation, confusing session state, wasted implement phase overhead.

**Proposed fix (two options):**

**Option A — Topic heuristic:** Add a heuristic in `src/index.ts` or `src/orchestrator.ts` that detects when a topic is likely planning-only (e.g., starts with "review", "analyze", "list", "check", "run") and suggests or auto-selects `--mode planning`.

**Option B — Graceful no-diff handling:** When the implement phase produces an empty diff, skip the review phase and worktree cleanup instead of proceeding through the full cycle. This is partially handled by `emptyDiffRetries` but could be more graceful — detect "this task doesn't need code changes" and finalize early.

**Recommended:** Option B is simpler and doesn't require heuristics. The orchestrator already tracks `emptyDiffRetries` — extend it to finalize gracefully after detecting the pattern.

**Files:** `src/orchestrator.ts` — empty diff handling around line 265
