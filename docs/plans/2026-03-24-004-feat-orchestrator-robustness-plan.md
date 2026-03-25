---
title: "feat: Orchestrator robustness -- stuck-loop detection, planning caps, fast-model tracking, ASCII enforcement, deliverable gates"
type: feat
status: complete
date: 2026-03-24
---

# Orchestrator Robustness Improvements

## Overview

Five targeted improvements to the DEF orchestrator, motivated by a real session (d79499d3) that took 12 planning turns for a document-writing task due to premature "done" signaling, false permission blockers, fast-model failures, and encoding issues in the deliverable.

## Problem Frame

Session d79499d3 exposed several gaps:
1. **Claude claimed "done" without writing the deliverable.** Codex had to block it. Turns 7-11 were wasted resolving a file that should have been gated.
2. **Claude repeated the same false excuse ("file write permissions") for 3 turns.** No mechanism detected the stuck loop.
3. **Fast model failed twice (turns 5, 7)**, each adding latency from escalation. No cross-turn tracking means fast tier keeps being attempted after repeated failures.
4. **The implementation produced mojibake** (`a-~` instead of em-dashes). No prompt guidance constrains output to ASCII-safe characters.
5. **No per-phase turn budget.** A 20-turn global cap is too generous for planning phases, especially on document-only tasks.

## Requirements Trace

- R1. Plan phase must not accept `done`/`decided` consensus without verifying that any file paths mentioned in decisions actually exist in the worktree or repo
- R2. Orchestrator must detect when an agent produces near-identical output across consecutive turns and escalate
- R3. Fast-model failures must be tracked across turns; after N consecutive failures, the tier selector should suppress fast for the remainder of the session
- R4. All prompt templates must instruct agents to use ASCII-safe punctuation
- R5. A `--plan-turns` CLI flag must cap the plan phase independently of `--max-turns`

## Scope Boundaries

- No changes to the watcher UI or React frontend
- No changes to the validation schema (frontmatter fields stay the same)
- No changes to session recovery / `recoverEphemeralState` beyond reading new counters
- No multi-agent support or new agent providers
- Deliverable gate is plan-phase only (checking file mentions in decisions); implement-phase already has `captureDiff`

## Context & Research

### Relevant Code and Patterns

- `src/orchestrator.ts` -- main loop, `selectModelTier()`, `invokeWithRetry()`, `recoverEphemeralState()`
- `src/context.ts` -- `planPrompt()`, `implementPrompt()`, `reviewPrompt()` templates
- `src/cli.ts` -- `ParsedArgs`, `parseArgs()`
- `src/session.ts` -- `Session` interface, `CreateSessionOptions`
- `src/index.ts` -- CLI validation and session creation
- `src/validation.ts` -- frontmatter extraction and field validation
- `src/__tests__/tier.test.ts` -- existing tier selection tests
- `src/__tests__/context.test.ts` -- existing prompt assembly tests
- Existing patterns: `emptyDiffRetries` + `MAX_EMPTY_DIFF_RETRIES` for implement-phase retry cap; `review_turns` for review-phase cap; `noFast` flag for suppressing fast tier

### Institutional Learnings

No `docs/solutions/` directory exists yet. These improvements should become the first documented learnings once shipped.

## Key Technical Decisions

- **Stuck-loop detection via content similarity, not exact match:** Agents often rephrase the same excuse slightly. Use a simple heuristic -- compare the `decisions` array and `status` field across consecutive same-agent turns rather than raw body text. If both are identical for 2 consecutive turns from the same agent, inject a system nudge or escalate.
- **Fast-failure counter is session-scoped, not turn-scoped:** Track consecutive fast-tier failures (invocation or validation) across turns. After 3 consecutive failures, set a session-level flag equivalent to `noFast`. This avoids the current pattern where fast is re-attempted every eligible turn despite always failing.
- **Deliverable gate checks file paths extracted from decisions:** Parse decision strings for file path patterns (e.g., strings containing `/` and a file extension). Verify those paths exist via `fs.access()`. This is a best-effort heuristic, not a strict contract.
- **Plan-turns default matches current behavior:** Default `--plan-turns` to 20 (same as `--max-turns`) so existing behavior is unchanged. Users can explicitly lower it for document-only tasks.
- **ASCII enforcement is prompt-level only:** No validation-layer rejection of non-ASCII content. The prompt instructs; the agent is responsible. This avoids rejecting legitimate non-English content.

## Open Questions

### Resolved During Planning

- **Should stuck-loop detection compare full body text?** No -- too noisy. Decision arrays + status are the meaningful signal. Two identical `decisions` arrays with the same `status` from the same agent is the clearest stuck indicator.
- **Should fast-failure tracking persist to session.json?** No. It is ephemeral orchestrator state, same as `emptyDiffRetries`. If the session is interrupted and the user re-runs, a fresh counter is fine.
- **Should deliverable gate block consensus or just warn?** Block. The whole point is preventing premature "done". If a mentioned file does not exist, the consensus is invalid -- clear `pendingPlanDecided` and continue the plan loop.

### Deferred to Implementation

- **Exact regex for extracting file paths from decision strings:** This depends on testing against real decision data. Start simple (look for strings matching `[word/]+\.[a-z]+`) and iterate.
- **Whether the stuck-loop system nudge should be a turn or an inline injection:** Implementation should try both and see which agents respond to better.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
orchestrator main loop
  |
  +-- selectModelTier()
  |     now also checks: consecutiveFastFailures >= MAX_FAST_FAILURES -> 'full'
  |
  +-- invokeWithRetry()
  |     on fast-tier failure: increment consecutiveFastFailures
  |     on fast-tier success: reset consecutiveFastFailures to 0
  |
  +-- plan-phase post-turn:
  |     +-- stuck-loop check:
  |     |     compare current turn's (decisions, status) to previous same-agent turn
  |     |     if identical for 2nd consecutive time -> inject nudge, clear pendingPlanDecided
  |     |
  |     +-- consensus gate (existing):
  |     |     if both agents decided:
  |     |       +-- NEW: deliverable gate
  |     |       |     extract file paths from accumulated decisions
  |     |       |     verify each exists via fs.access()
  |     |       |     if any missing: log warning, clear pendingPlanDecided, continue loop
  |     |       |
  |     |       +-- (existing) generate plan artifact, create worktree, transition to implement
  |     |
  |     +-- plan-turns budget check:
  |           if planTurnCount >= session.plan_turns: force transition or end
  |
  +-- all prompts now include:
        "Use ASCII-safe punctuation only (-, --, not em/en dashes or special Unicode)."
```

## Implementation Units

- [x] **Unit 1: ASCII enforcement in prompt templates** (PR #30)

**Goal:** Prevent encoding issues in agent output by instructing agents to use ASCII-only punctuation.

**Requirements:** R4

**Dependencies:** None

**Files:**
- Modify: `src/context.ts` (planPrompt, implementPrompt, reviewPrompt)
- Test: `src/__tests__/context.test.ts`

**Approach:**
- Add a shared line to all three prompt templates: "Use ASCII-safe punctuation only. Use - or -- instead of em-dashes or en-dashes. Do not use Unicode special characters."
- Extract it as a constant (e.g., `ASCII_RULE`) included in each prompt function to avoid duplication.

**Patterns to follow:**
- Existing "Do NOT include anything before the opening ---" rule pattern in each prompt

**Test scenarios:**
- Each prompt function output contains the ASCII constraint text
- Prompt content does not itself contain non-ASCII characters

**Verification:**
- `npm test` passes with updated context tests
- `npm run typecheck` passes

---

- [x] **Unit 2: `--plan-turns` CLI flag and session field** (PR #31)

**Goal:** Add a per-phase turn budget for the plan phase so users can cap planning independently.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `src/cli.ts` (ParsedArgs, parseArgs)
- Modify: `src/session.ts` (Session interface, CreateSessionOptions, create function)
- Modify: `src/index.ts` (validation, session creation)
- Modify: `src/orchestrator.ts` (plan-phase turn counting and budget enforcement)
- Test: `src/__tests__/normalizeStatus.test.ts` (or new test file for plan-turns logic)

**Approach:**
- Add `planTurns?: number` to `ParsedArgs` and parse `--plan-turns` in the switch block
- Add `plan_turns: number` to `Session` interface and `CreateSessionOptions`
- Default to `max_turns` when not specified (preserves current behavior)
- Validate: 1-100 range, same as `maxTurns`
- In the orchestrator, track `planTurnCount` (incremented each plan-phase turn). When `planTurnCount >= session.plan_turns`, force-end the plan phase -- either transition to implement with current decisions or end with a status message
- Update `recoverEphemeralState` to reconstruct `planTurnCount` from plan-phase turns
- Show `--plan-turns` in the usage string

**Patterns to follow:**
- `review_turns` / `--review-turns` pattern for CLI flag, validation, and session field
- `emptyDiffRetries` / `MAX_EMPTY_DIFF_RETRIES` pattern for orchestrator-level counting

**Test scenarios:**
- `parseArgs(['--plan-turns', '6'])` returns `{ planTurns: 6 }`
- Plan-turns defaults to max-turns when not specified
- Plan phase ends when planTurnCount reaches budget
- Recovery reconstructs planTurnCount correctly from turn files

**Verification:**
- `npm test` passes
- `npm run typecheck` passes
- Manual: `def --plan-turns 4 --topic "test"` limits planning to 4 turns

---

- [x] **Unit 3: Fast-model failure tracking across turns** (PR #32)

**Goal:** Stop re-attempting fast tier after repeated failures within a session.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `src/orchestrator.ts` (selectModelTier signature, invokeWithRetry, main loop state)
- Test: `src/__tests__/tier.test.ts`

**Approach:**
- Add `consecutiveFastFailures: number` to orchestrator ephemeral state (alongside `emptyDiffRetries`)
- Define `MAX_FAST_FAILURES = 3`
- In `invokeWithRetry`: when `tier === 'fast'` and the invocation fails (before or after escalation), increment `consecutiveFastFailures`. On any fast-tier success, reset to 0
- Extend `selectModelTier` with a new parameter `fastSuppressed: boolean`. When true, return `'full'` regardless of consensus signals
- Set `fastSuppressed = consecutiveFastFailures >= MAX_FAST_FAILURES` before each `selectModelTier` call
- Emit a tracer event (`fast.suppressed`) when the threshold is first crossed
- Do not persist to session.json -- ephemeral state only

**Patterns to follow:**
- `emptyDiffRetries` + `MAX_EMPTY_DIFF_RETRIES` counter pattern
- `noFast` flag precedence in `selectModelTier`

**Test scenarios:**
- `selectModelTier` returns `'full'` when `fastSuppressed` is true, even with consensus signals
- `selectModelTier` returns `'fast'` when `fastSuppressed` is false and consensus signals present
- Counter resets on fast-tier success (not just on phase change)
- Counter persists across turns within the same session

**Verification:**
- `npm test` passes with updated tier tests
- `npm run typecheck` passes

---

- [x] **Unit 4: Stuck-loop detection in plan phase** (PR #33)

**Goal:** Detect when an agent repeats the same output across consecutive turns and break the loop.

**Requirements:** R2

**Dependencies:** None

**Files:**
- Modify: `src/orchestrator.ts` (plan-phase post-turn logic)
- Test: `src/__tests__/recovery.test.ts` (or new test file)

**Approach:**
- Track `lastAgentOutput: Map<AgentName, { decisions: string[], status: string }>` in ephemeral state
- After each plan-phase turn, compare the current turn's `(decisions, status)` to the stored value for the same agent
- "Identical" means: same status string AND decisions arrays are deep-equal (same length, same elements in order)
- If identical: increment a per-agent repetition counter. If counter reaches 2 (same output 3 times total):
  - Emit tracer event `plan.stuck` with agent name and turn count
  - Log a UI warning: "Agent X appears stuck. Injecting nudge."
  - Clear `pendingPlanDecided` if set (prevent false consensus)
  - Write a system turn with a nudge message instructing the agent to try a different approach or escalate to the other agent
- If not identical: reset the counter for that agent and update stored output
- Do not reconstruct this state in recovery -- it is only useful for detecting live loops

**Patterns to follow:**
- `emptyDiffRetries` pattern for counter + max check
- Error turn / system turn writing for the nudge injection

**Test scenarios:**
- No detection when decisions differ between turns
- No detection when status differs between turns
- Detection triggers after 3 identical consecutive outputs from the same agent
- `pendingPlanDecided` is cleared on detection
- Different agents' counters are independent

**Verification:**
- `npm test` passes
- `npm run typecheck` passes

---

- [x] **Unit 5: Deliverable existence gate before plan consensus** (PR #34)

**Goal:** Prevent premature "done" when agreed-upon file deliverables do not exist.

**Requirements:** R1

**Dependencies:** Unit 2 (plan-turns cap provides the safety net if the gate keeps blocking consensus)

**Files:**
- Modify: `src/orchestrator.ts` (consensus detection block in plan-phase)
- Create: `src/deliverable.ts` (file path extraction and verification logic)
- Test: `src/__tests__/deliverable.test.ts`

**Approach:**
- New module `src/deliverable.ts` with two exported functions:
  - `extractFilePaths(decisions: string[]): string[]` -- scan decision strings for substrings matching file path patterns (contain `/` or `\` and end with a file extension). Deduplicate results
  - `verifyDeliverables(paths: string[], repoRoot: string): Promise<{ missing: string[] }>` -- check each path with `fs.access()` resolved against repoRoot. Return list of missing paths
- In the consensus detection block (orchestrator line 397-408), after both agents signal `decided`:
  - Collect all decisions from all plan-phase turns
  - Call `extractFilePaths` then `verifyDeliverables`
  - If `missing.length > 0`: emit tracer event `deliverable.missing`, log UI warning listing missing files, clear `pendingPlanDecided`, continue loop (do not transition to implement)
  - If all present: proceed with existing flow (generate plan artifact, create worktree, etc.)
- The gate only fires once per consensus attempt. If the agent's next turn adds the file and re-signals `decided`, it will be re-checked

**Patterns to follow:**
- `captureDiff` + empty-check pattern for gating phase transitions
- Separate module for testable logic (like `src/validation.ts`)

**Test scenarios:**
- `extractFilePaths` extracts paths like `docs/plans/foo.md`, `src/bar.ts` from decision strings
- `extractFilePaths` ignores non-path strings, URLs, and code references without extensions
- `extractFilePaths` handles decision strings with mixed content (path embedded in prose)
- `verifyDeliverables` returns empty `missing` when all files exist
- `verifyDeliverables` returns correct `missing` list when files are absent
- Gate blocks consensus when deliverable is missing
- Gate allows consensus when all deliverables exist

**Verification:**
- `npm test` passes with new deliverable tests
- `npm run typecheck` passes
- Manual: run a planning session where the plan references a file -- consensus should not complete until the file exists

## System-Wide Impact

- **Interaction graph:** All changes are internal to the orchestrator loop. No callbacks, middleware, or external services affected. The watcher UI server (`src/server.ts`) reads session state but does not need changes -- new fields are orchestrator-internal
- **Error propagation:** Stuck-loop nudges and deliverable gate blocks are handled within the plan-phase branch, not as errors. They produce system turns or UI warnings, not exceptions
- **State lifecycle risks:** All new counters are ephemeral (not persisted to session.json). No partial-write concerns. `planTurnCount` is reconstructed from turn files during recovery
- **API surface parity:** The watcher UI API (`/api/session`) returns session.json fields. `plan_turns` will appear there naturally. No UI changes needed to display it
- **Integration coverage:** Manual end-to-end testing with `def` is the primary integration path. Unit tests cover the exported functions and orchestrator logic in isolation

## Risks & Dependencies

- **File path extraction is heuristic:** Decision strings are free-text. The regex may have false positives (matching non-path strings) or false negatives (missing unusual path formats). Mitigated by keeping the gate as a warning + loop-continuation rather than a hard error
- **Stuck-loop detection may fire on legitimate repeated decisions:** Two turns that genuinely agree on the same decisions (e.g., both confirming the same list) would look identical. Mitigated by requiring 3 consecutive identical outputs, and by only checking same-agent turns (cross-agent agreement is the consensus mechanism, not a stuck loop)
- **Plan-turns cap may force premature transition:** If planning genuinely needs more turns, the cap could cut off a productive debate. Mitigated by defaulting to `max_turns` (no behavior change unless explicitly set)

## Sources & References

- Session d79499d3 turns and artifacts (`.def/sessions/d79499d3-*/`)
- `src/orchestrator.ts` -- main loop, consensus detection, tier selection
- `src/context.ts` -- prompt templates
- `src/cli.ts`, `src/session.ts`, `src/index.ts` -- CLI and session types
- `src/__tests__/tier.test.ts`, `src/__tests__/context.test.ts` -- existing test patterns
