---
title: "feat: Adaptive model tiering for plan-phase turns"
type: feat
status: completed
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-adaptive-model-tiering-requirements.md
deepened: 2026-03-24
---

# feat: Adaptive Model Tiering

## Enhancement Summary

**Deepened on:** 2026-03-24
**Research agents used:** architecture-strategist, kieran-typescript-reviewer, pattern-recognition-specialist, performance-oracle, security-sentinel, code-simplicity-reviewer, best-practices-researcher

### Key Improvements
1. Simplified data structures: `bothEverDecided: boolean` replaces `Set<AgentName>`, `FAST_MODELS` flattened to `Record<AgentName, string>`
2. Route `noFast` via `RunOptions` (matching `noPr` pattern) instead of persisting to `Session`
3. Inline `selectModelTier()` into orchestrator.ts (exported for testing) instead of a separate module
4. Updated to account for actual `invokeOnce`/`invokeWithRetry` signatures (which include `tracer`, `attemptCounters`, `label` params)
5. Dropped `model_tier` from `ThinkingState` — TurnCard badge is sufficient

### New Considerations Discovered
- Validation retry always escalates to full model (the `retryTier` ternary simplifies to `'full'`)
- Error turns should record the tier that was in use when the error occurred
- `CHAR_BUDGET` in context.ts should be annotated with Haiku context window constraint
- Prompt caching opportunity: structure prompts with stable prefix for Anthropic cache hits (future work)

## Overview

Add heuristic-based model tier selection to DEF so that confirmation/consensus turns in the plan phase use cheaper, faster models (e.g. Claude Haiku, Codex o4-mini) while implementation and review turns always use full-capability models. On by default with visible `[fast]` indicators; disabled via `--no-fast`.

## Problem Statement / Motivation

DEF always invokes agents at full capability regardless of task complexity. Late-debate confirmation turns — where an agent is essentially saying "yes, I agree" — don't need the same model power as initial analysis. This wastes cost and adds latency for turns where a cheaper model would produce equivalent output. (see origin: `docs/brainstorms/2026-03-24-adaptive-model-tiering-requirements.md`)

## Proposed Solution

An exported `selectModelTier()` function in the orchestrator uses phase and consensus signals to decide `'full' | 'fast'` per turn. The tier is passed to `agent.invoke()` which appends `--model <name>` to CLI args when a fast model is selected. If a fast-model turn fails YAML validation, the validation retry uses the full model as a fallback.

## Technical Considerations

### Key Design Decisions (carried from origin)

- **CLI flags over agent self-selection:** DEF controls tier externally via `--model`, keeping model selection deterministic and observable.
- **Heuristic rules over turn-count thresholds:** Using semantic signals (`status: decided`) is more precise than arbitrary turn numbers. This is the right approach for a CLI tool with 10-20 turns per session — classifier-based routing only pays off at 1000+ requests/day (see RouteLLM, ICLR 2025).
- **On by default with visibility:** `--no-fast` escape hatch available.

### R3a Simplification

The origin doc's R3a ("after first approve, subsequent review turns use fast") is **unreachable** in the current codebase — `verdict: approve` breaks the turn loop immediately at `orchestrator.ts:449`. Review-phase downshifting is therefore a no-op. The plan implements R3 as: **review phase always uses full model**. If the review loop structure changes later, R3a can be revisited.

### R8 Retry Integration

The existing validation retry (`orchestrator.ts:224-236`) re-invokes the same agent on frontmatter failure. R8 modifies this: when the current tier is `fast`, the validation retry always uses the full model. This keeps the total invocation count unchanged (max 2 attempts) while providing a meaningful fallback.

**Note:** The *invocation* retry in `invokeWithRetry()` (timeout/crash/empty output) always retries with the same tier. Only the *validation* retry escalates from fast→full. This is intentional — invocation failures (timeouts, crashes) are infrastructure issues unrelated to model capability, so escalating the model tier wouldn't help.

### Context Window Consideration

Fast models (Haiku) have a 200K-token context window. The context assembler truncates to `CHAR_BUDGET = 400_000` chars (~100K tokens at 4 chars/token, though code-heavy content may compress closer to 3 chars/token yielding ~133K tokens). This is within Haiku's limits but without wide margins. The R8 retry fallback provides a safety net for edge cases. Add a comment to `CHAR_BUDGET` in `src/context.ts` noting the Haiku constraint so future contributors don't raise it.

### Simplification Rationale

Several structures from the original plan were simplified based on review:
- **`bothEverDecided: boolean` instead of `Set<AgentName>`:** With exactly 2 agents, a Set is generic machinery for a 2-state problem. A boolean is clearer and simpler to recover.
- **`FAST_MODELS: Record<AgentName, string>` instead of nested `{ fast: string }`:** The nested object held a single field. Since full-model means "no `--model` flag" (use CLI default), only the fast model name needs storing.
- **`RunOptions.noFast` instead of `Session.no_fast`:** Matches the `noPr` precedent. Sessions are single-use (no resume), so persisting this flag serves no purpose.
- **Inline `selectModelTier()` in orchestrator.ts instead of separate `src/tier.ts`:** 10-line pure function with one call site. Exported for testability, but no need for a dedicated module.
- **No `model_tier` on `ThinkingState`:** The thinking indicator is visible for seconds; the permanent TurnCard badge is the authoritative record. Saves 4 integration points (Controller, server, UI type, ThinkingIndicator component).

## System-Wide Impact

- **Interaction graph:** `selectModelTier()` → `invokeWithRetry()` → `invokeOnce()` → `invoke()` → `spawn(cmd, [...args, '--model', tier])`. Turn metadata gains `model_tier` field → `writeCanonicalTurn()` → turn YAML file → `/api/turns` → React UI `TurnCard`.
- **Error propagation:** Fast-model validation failure triggers full-model retry via existing retry path. No new error types introduced.
- **State lifecycle risks:** New `bothEverDecided` boolean in orchestrator ephemeral state. Must be recoverable from turn history via `recoverEphemeralState()`. This flag is **monotonically additive** — once set to `true`, it is never cleared (even on contested consensus). Loss on crash causes conservative behavior (full model), not incorrect behavior.
- **API surface parity:** The `/api/turns` response and UI `Turn` type both gain the optional `model_tier` field. No changes to `ThinkingState`.
- **Assumption:** Plan-phase turns always alternate agents (orchestrator line 304: `oppositeAgent`). The heuristic relies on this — if Agent A emits `decided`, the next turn is always Agent B (which gets the fast model). If the alternation model changes, the heuristic would need revisiting.

## Acceptance Criteria

### Phase 1: Tier-Aware Invocation + Heuristic

**CLI & configuration:**
- [ ] Add `--no-fast` flag to CLI parser (`src/cli.ts`) following the `--no-pr` pattern
- [ ] Add `noFast?: boolean` to `ParsedArgs` (`src/cli.ts`)
- [ ] Add `--no-fast` to the usage string (`src/index.ts`)
- [ ] Add `noFast?: boolean` to `RunOptions` in `src/orchestrator.ts` (alongside existing `noPr`)
- [ ] Pass `noFast` from parsed args through to `run()` (`src/index.ts`)

**Agent invocation (`src/agent.ts`):**
- [ ] Add `FAST_MODELS` constant, private to `agent.ts`:
  ```typescript
  const FAST_MODELS = {
    claude: 'haiku',
    codex: 'o4-mini',
  } as const satisfies Record<AgentName, string>;
  ```
- [ ] Add optional `tier?: 'full' | 'fast'` parameter to `invoke()` signature
- [ ] When `tier` is `'fast'`, resolve to `FAST_MODELS[agentName]` and append `['--model', resolvedName]` to args before `spawn()` (after line 84, before line 90). Both CLIs accept `--model`.
- [ ] When `tier` is `'full'` or `undefined`, pass no `--model` flag (use CLI default)

**Heuristic + orchestrator state (`src/orchestrator.ts`):**
- [ ] Add `model_tier?: 'full' | 'fast'` to `CanonicalTurnData` interface
- [ ] Add `bothEverDecided: boolean` to `RecoveredState` interface
- [ ] Update `recoverEphemeralState()`: scan plan-phase turns; track which agents have emitted `decided`/`done` via two booleans; set `bothEverDecided = true` once both agents have. This is **monotonically additive** — once true, never cleared.
- [ ] Add exported `selectModelTier()` function in `src/orchestrator.ts`:
  ```typescript
  export function selectModelTier(
    phase: SessionPhase,
    noFast: boolean,
    pendingPlanDecided: AgentName | null,
    bothEverDecided: boolean,
  ): 'full' | 'fast' {
    if (noFast) return 'full';
    if (phase !== 'plan') return 'full';
    if (bothEverDecided) return 'fast';
    if (pendingPlanDecided) return 'fast';
    return 'full';
  }
  ```
- [ ] Initialize `bothEverDecided` from `recoverEphemeralState()` in `run()`, alongside existing state. For fresh sessions (`current_turn === 0`), default to `false`.
- [ ] Call `selectModelTier()` before `invokeWithRetry()` in the turn loop
- [ ] Track `bothEverDecided` — update when a plan-phase turn emits `decided`/`done` (in the consensus logic block)
- [ ] Pass selected tier through the invocation chain. **Important:** `invokeWithRetry()` and `invokeOnce()` already have 5-6 parameters including `tracer`, `attemptCounters`, and `label`. Add `tier` to the existing parameter lists (or consider refactoring to an options object if the implementer judges it worthwhile — the TS reviewer flagged 7 positional params as a maintainability concern).
- [ ] `invoke()` in `agent.ts` resolves `'fast'` → model name internally via `FAST_MODELS`
- [ ] Set `model_tier` on `canonicalData` before writing turn
- [ ] Also set `model_tier` on error turns in `writeErrorTurn()` — record which tier was in use when the error occurred, for diagnostics

### Phase 2: Validation Retry Escalation (R8)

- [ ] Modify the validation retry block (`src/orchestrator.ts:224-236`): when the current tier is `'fast'`, retry with full model
  ```typescript
  // The validation retry always uses the full model:
  if (currentTier === 'fast') {
    console.log(`[Turn ${turnCount}] Fast model failed validation. Retrying with full model...`);
  } else {
    console.log(`[Turn ${turnCount}] Retrying...`);
  }
  result = await invokeOnce(nextAgent, session, turnCount, tracer, attemptCounters, 'validation-retry', 'full');
  ```
  **Note:** `retryTier` is always `'full'` — if `currentTier` is already `'full'`, the retry also uses `'full'` (no `--model` flag). The conditional only controls the log message.
- [ ] If the retry succeeds, update `canonicalData.model_tier` to `'full'` (the turn was ultimately produced by the full model)

### Phase 3: CLI & UI Visibility (R5)

**CLI output:**
- [ ] Add `[fast]` to the turn-written console log line:
  ```
  [Turn N] [plan] [fast] Written: turn-0003-claude (status: decided)
  ```
  Only show `[fast]` when `model_tier === 'fast'` — omit for full-tier turns.
- [ ] Add `[fast]` to the ticker display in `startTicker()` — this requires adding a `tier` parameter to `startTicker()`

**React UI:**
- [ ] Add `model_tier?: 'full' | 'fast'` to UI `Turn` interface (`src/ui/src/lib/types.ts`)
- [ ] Pass `model_tier` through in `handleGetTurns()` (`src/server.ts`) — add `model_tier: parsed.data?.model_tier` to the turn object. **Note:** The `Controller` interface is duplicated in `server.ts` (lines 10-17) and `orchestrator.ts` — no changes needed to either `Controller` since we're not adding `model_tier` to `ThinkingState`.
- [ ] Add `[fast]` badge to `TurnCard` between phase badge and duration, using the codebase's `cn()` pattern:
  ```tsx
  const FAST_BADGE_STYLE = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25";

  // In the badge row:
  {turn.model_tier === 'fast' && (
    <Badge variant="outline" className={cn(
      "font-mono text-[9px] font-normal tracking-wide",
      FAST_BADGE_STYLE
    )}>
      fast
    </Badge>
  )}
  ```

### Phase 4: Tests

- [ ] Add `selectModelTier()` unit tests in `src/__tests__/tier.test.ts` (imports from `src/orchestrator.ts`):
  - `noFast=true` → always `'full'`
  - `phase='implement'` → always `'full'`
  - `phase='review'` → always `'full'`
  - `phase='plan'` + no signals → `'full'`
  - `phase='plan'` + `pendingPlanDecided` set → `'fast'`
  - `phase='plan'` + `bothEverDecided=true` → `'fast'`
  - `phase='plan'` + `pendingPlanDecided` set AND `bothEverDecided=true` → `'fast'` (precedence test)
  - `phase='plan'` + only one agent ever decided, no pending → `'full'` (gap state)
- [ ] Add `bothEverDecided` recovery test in `src/__tests__/recovery.test.ts`
- [ ] Add `CHAR_BUDGET` comment in `src/context.ts` noting Haiku constraint
- [ ] Add new test file to `package.json` test list
- [ ] Run `npm test` and `npm run typecheck` to verify

## Dependencies & Risks

- **Claude CLI `--model` flag:** Confirmed. `claude --model haiku` sets the model.
- **Codex CLI `--model` flag:** Confirmed. `codex exec --model o4-mini` sets the model. Exact fast-tier model name may need adjustment.
- **Risk: Fast model structured output quality.** Cheaper models may be less reliable at producing valid YAML frontmatter. Mitigated by R8 (validation retry with full model).
- **Risk: Context window overflow on fast model.** Late plan-phase turns with code-heavy content could approach Haiku's 200K-token limit. Mitigated by existing 400K char truncation and R8 fallback.
- **Security:** All model names come from hardcoded `FAST_MODELS` constant (not user input). Args passed as array to `spawn()` (no shell interpolation). Agent output cannot influence tier selection for the current turn (tier is decided before invocation). No vulnerabilities identified.

## Future Considerations

These are **not in scope** but surfaced during research as natural extensions:

- **Prompt cache-friendliness:** Structure prompts with a stable prefix (system instructions) and variable suffix (turn history) to maximize Anthropic prompt cache hits. Expected savings: 50-90% on cached prefix tokens for turns 2+.
- **Telemetry:** Log model tier, token counts (if available from CLI output), and duration per turn. This data would inform whether tier defaults are correct and whether adaptive routing is worth adding.
- **Per-phase tier defaults:** Instead of binary full/fast, support per-phase model configuration (e.g., `--debate-model`, `--review-model`). The current architecture supports this naturally.

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-adaptive-model-tiering-requirements.md](../brainstorms/2026-03-24-adaptive-model-tiering-requirements.md) — Key decisions carried forward: CLI flags over self-selection, heuristic rules over turn-count thresholds, on-by-default with visibility.

### Internal References

- Agent spawning: `src/agent.ts:59-96` (invoke function, args construction)
- Turn loop: `src/orchestrator.ts:167-256` (agent selection, invoke, validation, canonical data)
- Validation retry: `src/orchestrator.ts:224-236`
- Invoke helpers: `src/orchestrator.ts:700-722` (`invokeOnce` has `tracer`, `attemptCounters`, `label` params)
- Recovery: `src/orchestrator.ts:614-667`
- RunOptions: `src/orchestrator.ts:45` (where `noPr` lives — `noFast` goes here too)
- CLI parsing: `src/cli.ts:1-49`
- Session types: `src/session.ts:14-47` (do NOT add `no_fast` here)
- UI turn card badges: `src/ui/src/components/turn-card.tsx:106-136`
- UI types: `src/ui/src/lib/types.ts:1-34`
- Server turn response: `src/server.ts:211-253`
- Context budget: `src/context.ts:27` (CHAR_BUDGET — add Haiku constraint comment)

### External References

- [RouteLLM: Cost-Effective LLM Routing (ICLR 2025)](https://lmsys.org/blog/2024-07-01-routellm/) — Confirms heuristic routing is appropriate at DEF's scale
- [SLM-Default, LLM-Fallback Pattern (Strathweb)](https://www.strathweb.com/2025/12/slm-default-llm-fallback-pattern-with-agent-framework-and-azure-ai-foundry/) — Validates the R8 escalation approach
- [Retries, Fallbacks, and Circuit Breakers in LLM Apps (Portkey)](https://portkey.ai/blog/retries-fallbacks-and-circuit-breakers-in-llm-apps/) — Layered retry patterns
- [LLM Cost Optimization: 8 Strategies (Prem AI)](https://blog.premai.io/llm-cost-optimization-8-strategies-that-cut-api-spend-by-80-2026-guide/) — Prompt caching, tier selection
