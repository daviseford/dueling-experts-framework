---
title: "feat: Restructure phase model (plan → implement → review pipeline)"
type: feat
status: active
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-phase-model-restructuring-requirements.md
depends:
  - docs/plans/2026-03-24-001-feat-worktree-isolation-plan.md
  - docs/plans/2026-03-24-002-feat-native-agent-execution-plan.md
---

# feat: Restructure Phase Model (Plan → Implement → Review Pipeline)

## Overview

Replace DEF's generic "debate" phase with a structured **plan → implement → review** pipeline. The plan phase produces a durable plan artifact on disk. The review phase becomes collaborative (both agents alternate, not single-agent). Planning mode stops after the plan phase; edit mode flows through all three phases with an implement/review fix loop.

## Problem Statement / Motivation

DEF's current phase model has two weaknesses (see origin: `docs/brainstorms/2026-03-24-phase-model-restructuring-requirements.md`):

1. **Planning mode produces no plan artifact.** The decision log captures individual decisions but not a cohesive plan. There is no durable handoff artifact.
2. **Edit mode lacks a structured pipeline.** Implementation starts without an agreed-upon plan, and review is single-agent — missing the adversarial rigor of two agents challenging each other.

The restructuring reframes "debate" as "plan" (same alternating mechanics), adds a `plan.md` artifact, and upgrades review to collaborative debate with explicit `verdict: approve | fix` signaling.

## Proposed Solution

Three-phase implementation:

1. **Phase 1 — Type foundation & rename.** Change `SessionPhase` from `'debate'` to `'plan'`, update all 16+ references across 15 files, add backward compatibility for old sessions.
2. **Phase 2 — Plan artifact & prompts.** Generate `plan.md` on consensus, update prompt builders, handle no-consensus gracefully.
3. **Phase 3 — Collaborative review.** Add `verdict` field, restructure review as two-agent debate, extend interjection support to review phase.

Native agent execution (R7) is handled by plan 002 (`docs/plans/2026-03-24-002-feat-native-agent-execution-plan.md`) and is a parallel concern — this plan cross-references but does not re-plan it.

## Technical Approach

### Architecture

The changes are organized by dependency order. Each phase is independently shippable and testable.

**Key architectural decisions carried forward from origin:**
- Same alternating-turn consensus mechanics, different framing (see origin: R1)
- Two artifacts: `decisions.md` + `plan.md` (see origin: R2)
- Plan = both decided turns concatenated (see origin: Key Decisions)
- Explicit `verdict` field over status overloading (see origin: R5)
- `--review-turns` counts loop iterations, not individual turns (see origin: R6)
- Plan artifact remains static after creation (see origin: Scope Boundaries)
- Human interjection in plan and review phases (see origin: R8)

### Implementation Phases

---

#### Phase 1: Type Foundation & Rename

Rename `debate` to `plan` across the codebase. This is a mechanical but wide-reaching change that should land first to avoid merge conflicts with functional changes.

##### 1.1 Update `SessionPhase` type

**`src/session.ts:12`**
```typescript
// Before
export type SessionPhase = 'debate' | 'implement' | 'review';

// After
export type SessionPhase = 'plan' | 'implement' | 'review';
```

Update default in `create()` (line 75): `phase: 'plan'`

Add backward-compat normalization in `load()` — when reading `session.json`, silently map `'debate'` → `'plan'`:
```typescript
// src/session.ts — inside load()
if (data.phase === 'debate') data.phase = 'plan';
```

This ensures old interrupted sessions resume correctly without widening the type union.

##### 1.2 Update all backend consumers

Every file referencing `'debate'` needs updating. Use `grep -rn "'debate'" src/` to find all instances. Key locations by function/block (line numbers are approximate — verify against current source):

| File | Location | Change |
|------|----------|--------|
| `src/orchestrator.ts` | `run()` phase init, `if (phase === 'debate')` block, `normalizeStatus()` default param, `writeErrorTurn`/`writeHumanTurn` fallbacks, interjection guard, log messages | `'debate'` → `'plan'`, rename comments |
| `src/context.ts` | `debatePrompt()` function name, string literals in `implementPrompt()` and `reviewPrompt()`, phase dispatch in `assemble()` | Rename `debatePrompt` → `planPrompt`, update string literals |
| `src/agent.ts` | Timeout comment | Update comment |
| `src/server.ts` | `handleGetTurns()` and `handleGetSession()` fallback values | Update fallback values |
| `src/recovery.ts` | (no direct reference — session loading handles via normalization in 1.1) | Verify no hardcoded `'debate'` |
| `src/index.ts` | Console output labels | Update if present |

##### 1.3 Update UI

| File | Change |
|------|--------|
| `src/ui/src/lib/types.ts:7,18` | `"debate"` → `"plan"` in `Turn` and `SessionPhase` types |
| `src/ui/src/components/turn-card.tsx` | Add `plan:` entry to `PHASE_STYLES`. **Keep the existing `debate:` entry** — old turn files have `phase: "debate"` in frontmatter and should retain their orange styling, not fall back to gray. |
| `src/ui/src/components/thinking-indicator.tsx` | Add `plan: "Planning"` to `PHASE_LABEL`. **Keep `debate: "Thinking"`** for old turn data. |
| `src/ui/src/hooks/use-polling.ts:45` | Default `useState<SessionPhase>("plan")` |
| `src/ui/src/components/session-header.tsx:87` | Update "debate session" copy |

##### 1.4 Update documentation

- `AGENTS.md` — all references to "debate" phase

##### 1.5 Update tests

- `src/__tests__/context.test.ts:35` — `phase: 'plan'`
- `src/__tests__/context.test.ts:88` — if testing mode rejection, update accordingly
- `src/__tests__/normalizeStatus.test.ts` — update default `phase` parameter expectations

##### 1.6 Acceptance criteria

- [ ] `SessionPhase` type is `'plan' | 'implement' | 'review'`
- [ ] `tsc --noEmit` passes
- [ ] All tests pass (`npm test`)
- [ ] Old sessions with `phase: 'debate'` in `session.json` load correctly and normalize to `'plan'`
- [ ] UI renders `plan` phase with correct styling and labels
- [ ] UI still renders old `debate` turns from turn history with original orange styling (explicit `debate:` entries retained in PHASE_STYLES and PHASE_LABEL)

---

#### Phase 2: Plan Artifact & Prompts

Generate `plan.md` on consensus and update prompts to use it.

##### 2.1 Generate `plan.md` artifact

Add `generatePlan()` to `src/orchestrator.ts`. Instead of threading turn paths through `pendingDecided`, scan the turns directory for the last two `decided` turns — the same approach used by `generateDecisions()`:

```typescript
// src/orchestrator.ts

async function generatePlan(session: Session): Promise<void> {
  const turnsDir = join(session.dir, 'turns');
  const files = (await readdir(turnsDir)).filter(f => f.endsWith('.md')).sort();
  const decidedTurns: { from: string; turn: number; content: string }[] = [];

  for (const file of files) {
    const raw = await readFile(join(turnsDir, file), 'utf-8');
    const { content, data } = matter(raw);
    if (data.status === 'decided') {
      decidedTurns.push({ from: data.from, turn: data.turn, content: content.trim() });
    }
  }

  // Take the last two decided turns (proposer + confirmer)
  const lastTwo = decidedTurns.slice(-2);
  if (lastTwo.length < 2) return; // safety: shouldn't happen at consensus

  const parts = lastTwo.map(t => `## ${t.from} (turn ${t.turn})\n\n${t.content}`);
  const planPath = join(session.dir, 'artifacts', 'plan.md');
  await atomicWrite(planPath, parts.join('\n\n---\n\n'));
}
```

This avoids refactoring `pendingDecided` from `AgentName | null` to `{ agent, turnPath }` — the scan approach is simpler, introduces zero interface changes, and follows the same pattern as `generateDecisions()`.

**Trigger point:** After both agents emit `decided` (consensus reached), **before** the planning-mode break and before the edit-mode phase transition. This ordering is critical — `generatePlan()` must fire before the planning-mode early exit.

```typescript
// Inside the consensus block, BEFORE checking mode === 'planning'
await generatePlan(session);
await generateDecisions(session); // existing

// THEN check mode for early exit vs. implement transition
if (session.mode === 'planning') {
  break; // R3: planning mode stops here, plan.md already written
}
// ... continue to worktree creation and implement transition
```

**Note:** `pendingDecided` stays as `AgentName | null` — no interface change needed.

##### 2.2 Update `planPrompt()` (renamed from `debatePrompt`)

**`src/context.ts`** — Rename function and update instructions to orient agents toward producing a plan:

```typescript
function planPrompt(agent: string, topic: string): string {
  return `You are ${agent}, collaborating with ${other} to produce an implementation plan for: ${topic}.

Your goal is to converge on a clear, actionable plan. Challenge assumptions, propose concrete approaches, and signal when you believe the plan is ready.

When you believe the plan is complete and agreed upon, set status: decided in your frontmatter. If both agents emit decided, the plan is finalized and implementation begins.

Include any key decisions in your frontmatter as decisions: [...]`;
}
```

##### 2.3 Update `implementPrompt()` to include plan artifact

**`src/context.ts`** — Load `plan.md` and inject as a fixed (non-truncatable) section:

```typescript
function implementPrompt(agent: string, topic: string, decisions: string[], planContent: string): string {
  return `You are ${agent}, implementing the plan agreed upon for: ${topic}.

## Plan
${planContent || '(No plan artifact found — implement based on the decisions below.)'}

## Key Decisions
${decisions.length > 0 ? decisions.map(d => `- ${d}`).join('\n') : '(No decisions recorded.)'}

You have full tool access. Make the changes described in the plan.`;
}
```

The `assemble()` function loads `plan.md` from `artifacts/`:

```typescript
// In assemble(), before prompt selection
let planContent = '';
if (phase === 'implement') {
  const planPath = join(session.dir, 'artifacts', 'plan.md');
  try { planContent = await readFile(planPath, 'utf-8'); } catch { /* no plan */ }
}
```

**Critical:** `planContent` is placed in the fixed system prompt section, not in the turn history. This ensures it survives context budget truncation on fix loops (addresses SpecFlow Gap 8).

##### 2.4 No-consensus handling (R10)

In the orchestrator's max_turns exhaustion path, add partial artifact generation:

```typescript
// When max_turns reached without consensus
if (phase === 'plan') {
  await generateDecisions(session); // write decisions.md if any exist
  // Do NOT write plan.md — no consensus was reached
  // Do NOT create worktree or transition to implement
  console.log('Plan phase exhausted max_turns without consensus. No implementation was performed.');
}
```

##### 2.5 Session completion output (R9)

Update the orchestrator's completion output (~line 377-383):

```typescript
// Add to completion output
const planPath = join(session.dir, 'artifacts', 'plan.md');
if (existsSync(planPath)) {
  console.log(`  Plan:      ${planPath}`);
}
```

##### 2.6 Acceptance criteria

- [ ] Consensus in both modes writes `artifacts/plan.md` containing both decided turns
- [ ] `plan.md` content has agent attribution and turn numbers
- [ ] Implement prompt includes plan.md content in a fixed (non-truncatable) section
- [ ] Max_turns exhaustion writes `decisions.md` but not `plan.md`
- [ ] Session completion output shows plan path when plan exists
- [ ] `tsc --noEmit` passes, all tests pass

---

#### Phase 3: Collaborative Review

The most complex phase. Restructure review from single-agent to two-agent collaborative debate with explicit verdict signaling.

##### 3.1 Add `verdict` field to data model

**`src/validation.ts`** — Update `TurnData` interface:

```typescript
export interface TurnData {
  id: string;
  turn: number;
  from: string;
  timestamp: string;
  status: TurnStatus;
  decisions?: string[];
  verdict?: 'approve' | 'fix';  // NEW — only valid in review phase
  [key: string]: unknown;
}
```

Add validation rule in `validate()`:

```typescript
// After status validation
if (data.verdict !== undefined) {
  if (data.verdict !== 'approve' && data.verdict !== 'fix') {
    errors.push(`Invalid verdict: ${data.verdict}. Must be 'approve' or 'fix'.`);
  }
}
```

**Verdict is required when `phase === 'review'` and `status === 'decided'`:**

The orchestrator should check this after validation succeeds — if the agent emits `decided` during review without a `verdict`, treat it as a validation error and trigger retry. This check belongs in the orchestrator (which knows the phase), not in `validate()` (which doesn't).

##### 3.2 Add `verdict` to `CanonicalTurnData` in orchestrator

Add `verdict` to the **existing** `CanonicalTurnData` interface (do not replace — it has other fields like `phase` and `duration_ms`):

```typescript
// src/orchestrator.ts — ADD to existing CanonicalTurnData interface
verdict?: 'approve' | 'fix';  // NEW — only populated in review phase
```

When writing review-phase turns, preserve the `verdict` field from the validated frontmatter in the canonical data.

##### 3.2b Update `normalizeStatus()` for review phase

The current `normalizeStatus()` treats `done` as equivalent to `decided` in the plan (debate) phase. In the review phase, `done` should also be mapped to `decided` — the verdict field replaces the old `done` = approved semantics:

```typescript
// In normalizeStatus(), add review phase handling:
// In review phase: 'done' → 'decided' (verdict field carries the approve/fix payload)
if (phase === 'review' && status === 'done') return 'decided';
```

This ensures agents that emit `done` instead of `decided` during review are handled consistently. If an agent emits `done` without a `verdict`, the orchestrator's missing-verdict check (section 3.1) will trigger a retry.

##### 3.2c Handle `needs_human` in review phase

The plan phase has `needs_human` handling that pauses the session and waits for human input. The review phase needs the same behavior. **Duplicate the `needs_human` logic inline** inside the review phase block — do not extract into a helper, because the handler references closure variables (`turnCount`, `isPaused`, `humanResponseResolve`, `waitForHuman()`) that are local to `run()`. Two inline copies (plan and review) is clearer than a nested closure helper with five parameters.

The review-phase `needs_human` block should be identical to the plan-phase one: pause, wait for human input (or exit if no server), write human turn, same agent resumes.

##### 3.3 Restructure review phase in orchestrator

**Replace the current single-agent review logic** (orchestrator lines 317-340) with collaborative debate mechanics that mirror the plan phase, extended with verdict handling.

**Key state additions:**
```typescript
let reviewPendingDecided: { agent: AgentName; verdict: 'approve' | 'fix' } | null = null;
let loopCount = 0; // counts implement→review iterations
```

**Review phase turn logic (replaces lines 317-340):**

```typescript
if (phase === 'review') {
  // NOTE: Interjection draining happens at the EXISTING location
  // (end of loop, section 3.6), NOT inside this block. The guard
  // at the existing location is widened to (plan || review).

  if (effectiveStatus === 'decided') {
    const verdict = canonicalData.verdict;
    if (!verdict) {
      // Missing verdict on decided in review — validation error, retry
      // (handled upstream — retry the agent invocation)
    }

    if (reviewPendingDecided && reviewPendingDecided.agent !== nextAgent) {
      // Other agent already signaled decided
      if (reviewPendingDecided.verdict === verdict) {
        // CONSENSUS — both agents agree on verdict
        if (verdict === 'approve') {
          // Approved — session complete
          break;
        } else {
          // verdict === 'fix' — loop back to implement
          loopCount++;
          if (loopCount >= session.review_turns) {
            console.log(`Review loop limit (${session.review_turns}) reached.`);
            break;
          }
          phase = 'implement';
          nextAgent = session.impl_model;
          reviewPendingDecided = null;
          await update(session.dir, { phase });
          continue;
        }
      } else {
        // MISMATCHED VERDICTS — contested consensus, continue review debate
        reviewPendingDecided = null;
        // Alternate to next agent
      }
    } else {
      // First decided in this review round — track it
      reviewPendingDecided = { agent: nextAgent, verdict };
      // Alternate to other agent for confirmation
    }
  } else if (effectiveStatus === 'complete' && reviewPendingDecided) {
    // Contested — other agent did not confirm decided
    reviewPendingDecided = null;
  }

  // Alternate agents (same as plan phase)
  nextAgent = nextAgent === 'claude' ? 'codex' : 'claude';
}
```

**Key difference from plan phase:** The plan phase consensus only needs "both decided." The review phase consensus needs "both decided with matching verdict." Mismatched verdicts behave like contested consensus — `reviewPendingDecided` is cleared and debate continues.

##### 3.4 Remove single-reviewer agent assignment

**Delete the hardcoded reviewer assignment** (orchestrator ~line 137-141):

```typescript
// REMOVE this block:
if (phase === 'review') {
  const implModel: AgentName = session.impl_model;
  nextAgent = implModel === 'claude' ? 'codex' : 'claude';
}
```

Replace with: after implement→review transition, set `nextAgent` to the non-implementing agent (so it reviews first), but then alternate on subsequent turns.

##### 3.5 Create `collaborativeReviewPrompt()`

**`src/context.ts`** — New prompt builder:

```typescript
function collaborativeReviewPrompt(
  agent: string,
  topic: string,
  decisions: string[],
  diff: string
): string {
  const other = agent === 'claude' ? 'codex' : 'claude';
  return `You are ${agent}, collaborating with ${other} to review an implementation for: ${topic}.

## Implementation Diff
\`\`\`diff
${diff}
\`\`\`

## Key Decisions from Planning
${decisions.length > 0 ? decisions.map(d => `- ${d}`).join('\n') : '(No decisions recorded.)'}

Review the implementation against the plan and decisions. Challenge ${other}'s assessment if you disagree. Consider correctness, completeness, edge cases, and adherence to the plan.

When you have formed your verdict, set \`status: decided\` and \`verdict: approve\` or \`verdict: fix\` in your frontmatter. If both agents emit decided with the same verdict, the review concludes.

If requesting fixes, describe specifically what needs to change.`;
}
```

Update `assemble()` phase dispatch to use `collaborativeReviewPrompt()` when `phase === 'review'`.

##### 3.6 Extend interjection support to review phase (R8)

**`src/orchestrator.ts`** — Update the interjection drain guard:

```typescript
// Before (line 342-343)
if (phase === 'debate' && interjectionQueue.length > 0) { ... }

// After
if ((phase === 'plan' || phase === 'review') && interjectionQueue.length > 0) { ... }
```

Update the drop warning:

```typescript
// Before (line 355-356)
if (phase !== 'debate' && interjectionQueue.length > 0) { ... }

// After
if (phase === 'implement' && interjectionQueue.length > 0) { ... }
```

**`needs_human` status** in review phase: Mirror the plan-phase behavior. The same agent resumes after the human turn.

**UI update** — `src/ui/src/components/interjection-input.tsx`: Disable the input when `phase === 'implement'`. Add a tooltip: "Interjections are not supported during implementation."

##### 3.7 Fix `recoverEphemeralState()` for new review model

**`src/orchestrator.ts`** — The recovery function (~lines 423-463) needs to reconstruct:
- `pendingDecided` for plan phase (existing, rename reference)
- `reviewPendingDecided` for review phase (NEW)
- `loopCount` for fix loop counting (NEW)

```typescript
function recoverEphemeralState(turns: TurnData[], session: Session): {
  pendingDecided: { agent: AgentName; turnPath: string } | null;
  reviewPendingDecided: { agent: AgentName; verdict: 'approve' | 'fix'; turnPath: string } | null;
  loopCount: number;
} {
  let pendingDecided = null;
  let reviewPendingDecided = null;
  let loopCount = 0;
  let currentPhase: SessionPhase = 'plan';

  for (const turn of turns) {
    // Track phase transitions by detecting implement/review boundaries
    // Count implement→review transitions as loopCount
    // Track decided/contested for both plan and review phases
    // For review turns with verdict, track reviewPendingDecided
  }

  return { pendingDecided, reviewPendingDecided, loopCount };
}
```

##### 3.8 Expose `verdict` in server API

**`src/server.ts`** — Update `handleGetTurns()` to include the `verdict` field in the turn data response. The current handler parses frontmatter and returns selected fields. Add `verdict` to the returned object when present:

```typescript
// In handleGetTurns(), where turn data is assembled
verdict: parsed.data?.verdict || undefined,
```

**`src/ui/src/lib/types.ts`** — Add `verdict` to the `Turn` interface:
```typescript
verdict?: "approve" | "fix";
```

This enables the UI to display verdict badges on review-phase turns.

##### 3.9 Handle no-diff on fix loop

When the implementing agent produces no new changes on a fix-loop iteration, transition to review with a note rather than retrying silently:

```typescript
// In implement phase, after captureDiff()
if (!diff && loopCount > 0) {
  // Fix loop produced no changes — surface to reviewers
  // Write a synthetic turn noting no changes were applied
  // Transition to review so agents can reassess
}
```

##### 3.11 Reset `emptyDiffRetries` on fix loops

The orchestrator tracks `emptyDiffRetries` to limit consecutive no-diff implement attempts. When transitioning from review back to implement on a fix loop, reset this counter:

```typescript
// In the verdict: fix transition block
emptyDiffRetries = 0;
phase = 'implement';
nextAgent = session.impl_model;
```

Without this, the counter carries state from a previous implement attempt and could cause premature session termination on re-entry.

##### 3.12 Default missing `verdict` on `decided` in review

When an agent emits `decided` during review without a `verdict` field, default to `verdict: 'approve'` rather than triggering a full agent re-invocation (which is expensive — 300s timeout). The rationale: an agent that says "decided" without qualification during review is more likely approving than requesting fixes. Log a warning when this default is applied.

```typescript
// In review phase, after status check
if (effectiveStatus === 'decided' && !canonicalData.verdict) {
  console.warn('Agent emitted decided without verdict in review phase — defaulting to approve');
  canonicalData.verdict = 'approve';
}
```

##### 3.10 Acceptance criteria

- [ ] `verdict?: 'approve' | 'fix'` field added to `TurnData` and `CanonicalTurnData`
- [ ] `verdict` validated when present; required when `phase === 'review'` and `status === 'decided'`
- [ ] Review phase alternates both agents (not single-reviewer)
- [ ] Both agents emitting `decided` + `verdict: approve` → session completes
- [ ] Both agents emitting `decided` + `verdict: fix` → transitions to implement, `loopCount` increments
- [ ] Mismatched verdicts → contested, review debate continues
- [ ] `--review-turns` counts loop iterations, not individual turns
- [ ] Interjection queue drains during review phase
- [ ] `needs_human` pauses during review phase (same as plan)
- [ ] Interjection input disabled in UI during implement phase
- [ ] `recoverEphemeralState()` correctly reconstructs `reviewPendingDecided` and `loopCount`
- [ ] No-diff on fix loop surfaces to reviewers instead of retrying silently
- [ ] `normalizeStatus()` maps `done` → `decided` in review phase
- [ ] `needs_human` pauses correctly in review phase (shared helper)
- [ ] Server API `/api/turns` includes `verdict` field for review turns
- [ ] `tsc --noEmit` passes, all tests pass

---

## Alternative Approaches Considered

1. **Keep single-agent review, add verdict field only.** Simpler, but loses the adversarial review dynamic. The brainstorm explicitly chose collaborative review (see origin: R5).

2. **Add a new `'verdict'` status value** instead of a frontmatter field. Would avoid schema changes but overloads the status field with phase-specific meaning. The origin explicitly chose "explicit verdict field over status overloading" (see origin: Key Decisions).

3. **Progressive enhancement** — ship rename first, then plan artifact, then collaborative review as separate PRs. Considered and adopted as the phasing strategy. Each phase is independently valuable.

## System-Wide Impact

### Interaction Graph

- Phase rename touches: `session.ts` (type), `orchestrator.ts` (logic), `context.ts` (prompts), `server.ts` (API), `recovery.ts` (resume), UI types + components. All are direct consumers of `SessionPhase`.
- New `verdict` field touches: `validation.ts` (schema), `orchestrator.ts` (consensus), `context.ts` (review prompt instructions). Agents must emit it — prompt instructions are the delivery mechanism.
- `plan.md` generation fires at consensus and feeds into `implementPrompt()`. The plan is also surfaced in session completion output.

### Error Propagation

- Validation error on missing `verdict` during review `decided` → triggers existing retry logic (1 auto-retry).
- `plan.md` write failure → caught by `atomicWrite()`, session can continue but implement prompt falls back to decisions-only.
- Mismatched verdicts do not propagate as errors — they're a normal state (contested consensus, debate continues).

### State Lifecycle Risks

- `pendingDecided` is ephemeral (reconstructed on recovery). Adding `reviewPendingDecided` follows the same pattern — no new persistence risk.
- `loopCount` is also ephemeral, reconstructed by counting phase transitions in turn history.
- `plan.md` is written atomically. If the process crashes between consensus and plan write, recovery re-enters plan phase (no plan written = no implement transition).

### API Surface Parity

- `GET /api/turns` returns turn data including the `phase` field. Clients must handle `'plan'` in addition to `'debate'`. The `verdict` field will appear in review-phase turn data.
- `GET /api/session` returns session state including `phase`. Same handling needed.
- `POST /api/interject` behavior changes: accepted in plan and review, silently dropped in implement.

### Integration Test Scenarios

1. **Full edit-mode pipeline:** Plan consensus → plan.md written → implement → diff captured → collaborative review → approve → session completes with all artifacts.
2. **Fix loop:** Plan → implement → review with `verdict: fix` → implement again (with full history) → review with `verdict: approve` → complete.
3. **Contested review:** Agent A says `decided + approve`, Agent B says `decided + fix` → mismatched → debate continues → both converge on same verdict.
4. **Recovery mid-review:** Crash during collaborative review → resume → `reviewPendingDecided` and `loopCount` correctly reconstructed → review continues.
5. **No-consensus planning mode:** 20 turns without consensus → `decisions.md` written, no `plan.md` → session ends with clear message.

## Acceptance Criteria

### Functional Requirements

- [ ] `SessionPhase` type is `'plan' | 'implement' | 'review'` (R1)
- [ ] Old sessions with `phase: 'debate'` load correctly, normalized to `'plan'` (backward compat)
- [ ] Plan consensus writes `artifacts/plan.md` with both decided turns concatenated (R2)
- [ ] Planning mode stops after plan phase, writes both artifacts (R3)
- [ ] Edit mode follows plan → implement → review pipeline (R4)
- [ ] Review phase uses both agents alternating with `verdict: approve | fix` (R5)
- [ ] `--review-turns` counts loop iterations; fix loops provide full history (R6)
- [ ] Native agent execution integration points identified (R7 — handled by plan 002)
- [ ] Human interjection works in plan and review, dropped in implement (R8)
- [ ] Session completion output includes plan.md path (R9)
- [ ] No-consensus plan phase writes partial decisions.md, no plan.md (R10)

### Non-Functional Requirements

- [ ] No new runtime dependencies (constraint from CLAUDE.md)
- [ ] Atomic writes for plan.md (constraint from AGENTS.md)
- [ ] `tsc --noEmit` passes after each phase
- [ ] All existing tests pass; new tests added for verdict validation, collaborative review consensus, plan artifact generation

### Test Plan

**Phase 1 tests** (`src/__tests__/rename.test.ts` or extend existing):
- `normalizeStatus()` with default `phase` parameter produces correct results (default changes from `'debate'` to `'plan'`)
- `assemble()` with `phase: 'plan'` produces a plan-oriented system prompt
- `session.load()` normalizes `phase: 'debate'` to `phase: 'plan'` in loaded session data
- `session.create()` defaults to `phase: 'plan'`

**Phase 2 tests** (`src/__tests__/plan-artifact.test.ts`):
- `generatePlan()` scans turns dir, finds two decided turns, concatenates content with agent attribution
- `generatePlan()` writes atomically to `artifacts/plan.md`
- `generatePlan()` handles edge case: only one decided turn (no-op)
- `assemble()` with `phase: 'implement'` includes `plan.md` content in the fixed prompt section
- `assemble()` with `phase: 'implement'` gracefully handles missing `plan.md` (falls back to decisions-only)
- `generatePlan()` fires before planning-mode break (verify plan.md exists after planning-mode session)

**Phase 3 tests** (`src/__tests__/collaborative-review.test.ts`):
- `validate()` accepts `verdict: 'approve'` and `verdict: 'fix'`
- `validate()` rejects `verdict: 'maybe'` (invalid value)
- `validate()` accepts turns with no `verdict` field (it's optional at the validation level)
- `normalizeStatus('done', turnCount, 'review')` returns `'decided'`
- Consensus: both agents emit `decided` + `verdict: 'approve'` → session completes
- Consensus: both agents emit `decided` + `verdict: 'fix'` → phase transitions to implement, `loopCount` increments
- Contested: Agent A emits `decided` + `verdict: 'approve'`, Agent B emits `decided` + `verdict: 'fix'` → `reviewPendingDecided` cleared, debate continues
- Contested: Agent A emits `decided`, Agent B emits `complete` → `reviewPendingDecided` cleared
- `loopCount` reaches `review_turns` limit → session ends
- `emptyDiffRetries` reset to 0 on fix loop transition
- Missing verdict on `decided` in review → defaults to `approve` with warning
- `recoverEphemeralState()` reconstructs `reviewPendingDecided` from turn history with verdict field
- `recoverEphemeralState()` reconstructs `loopCount` by counting implement→review phase transitions in turn history

### Quality Gates

- [ ] Each phase has a passing test suite before moving to the next
- [ ] `npm test` and `npm run typecheck` pass

## Dependencies & Prerequisites

- **Worktree isolation** (plan 001) — must be implemented first. The implement phase runs in an isolated worktree. Partially implemented on `feat/worktree-isolation` branch.
- **Native agent execution** (plan 002) — the implement phase uses native agent invocation (not `--print`). Can be implemented in parallel with Phase 3 of this plan since they touch different code paths.
- **No external dependencies.** All changes are internal to the DEF codebase.

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Collaborative review never converges (agents talk past each other) | Review loops exhaust `review_turns` | The existing `review_turns` safety valve handles this. Default of 6 loop iterations provides ample room. |
| Plan.md content is too thin (confirming turn is just "I agree") | Implementing agent gets poor guidance | Plan concatenates both decided turns. Prompt instructions orient agents toward substantive planning. |
| Old sessions break after rename | Users lose access to interrupted sessions | Silent `'debate'` → `'plan'` normalization in `session.load()`. UI keeps fallback styles for old turn data. |
| Context budget exceeded on deep fix loops | Implementing agent loses plan context | Plan.md loaded as fixed (non-truncatable) prompt section, separate from turn history. |
| Agents forget to include `verdict` in review frontmatter | Validation errors, retries | `verdict` is required on `decided` in review phase. Prompt instructions are explicit. Existing retry logic (1 auto-retry) handles occasional omission. |
| Review debate within a single round never converges | Agents alternate indefinitely within review | `max_turns` (global turn limit, default 20) is the backstop. No per-round limit needed — `max_turns` caps total turns across all phases. |

## Outstanding Questions (Deferred from Origin)

These questions were flagged in the origin document as "Deferred to Planning." Resolutions:

1. **Review prompt template for collaborative reviewers** — Resolved: `collaborativeReviewPrompt()` defined in Phase 3.5.
2. **Cumulative vs. incremental diff on fix loops** — Resolution: Use cumulative diff (already captured by `captureDiff()`). The plan artifact in the fixed prompt section ensures reviewers have full context even if the diff is truncated. If incremental diffs are needed later, committing at each implement boundary enables `git diff <prev>..HEAD`.
3. **How native agent receives the plan as context** — Deferred to plan 002. The plan artifact is loaded by `implementPrompt()` and passed to the agent via the prompt assembly pipeline. The delivery mechanism (stdin pipe vs. `-p` flag) is a plan-002 concern.
4. **Synthetic turn structure for implement phase** — Deferred to plan 002. The implement phase writes a synthetic turn with orchestrator-assigned metadata and the diff as body.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-phase-model-restructuring-requirements.md](docs/brainstorms/2026-03-24-phase-model-restructuring-requirements.md) — Key decisions carried forward: phase rename with same mechanics, plan = both decided turns, explicit verdict field, collaborative review, full history on fix loops.

### Internal References

- Session types: `src/session.ts` — `SessionPhase` type (line 12), `create()`, `load()`
- Consensus logic: `src/orchestrator.ts` — `if (phase === 'plan')` block in `run()`, `pendingDecided` tracking
- Phase transitions: `src/orchestrator.ts` — consensus→implement block, `captureDiff()`→review block, review fix loop
- Prompt builders: `src/context.ts` — `debatePrompt()` (→ `planPrompt()`), `implementPrompt()`, `reviewPrompt()` (→ `collaborativeReviewPrompt()`)
- Validation: `src/validation.ts` — `TurnData` interface, `TurnStatus` type, `validate()` function
- Interjection handling: `src/orchestrator.ts` — `interjectionQueue`, drain guard, `needs_human` handler
- Artifact generation: `src/orchestrator.ts` — `generateDecisions()`, `writeDiffArtifact()`
- Recovery: `src/orchestrator.ts` — `recoverEphemeralState()` function
- Status normalization: `src/orchestrator.ts` — `normalizeStatus()` function
- Server API: `src/server.ts` — `handleGetTurns()`, `handleGetSession()`
- UI phase types: `src/ui/src/lib/types.ts` — `Turn` interface, `SessionPhase` type
- UI phase rendering: `src/ui/src/components/turn-card.tsx` (`PHASE_STYLES`), `thinking-indicator.tsx` (`PHASE_LABEL`)

### Related Work

- Worktree isolation plan: `docs/plans/2026-03-24-001-feat-worktree-isolation-plan.md`
- Native agent execution plan: `docs/plans/2026-03-24-002-feat-native-agent-execution-plan.md`
- Native agent execution requirements: `docs/brainstorms/2026-03-24-native-agent-execution-requirements.md`
