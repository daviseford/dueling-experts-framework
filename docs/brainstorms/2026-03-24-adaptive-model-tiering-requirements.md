---
date: 2026-03-24
topic: adaptive-model-tiering
---

# Adaptive Model Tiering

## Problem Frame

DEF always invokes agents at full capability regardless of task complexity. Late-debate confirmation turns and straightforward review approvals don't need the same model power as initial analysis or implementation. This wastes cost and adds latency for turns where a cheaper, faster model would produce equivalent output.

## Requirements

- R1. DEF selects a model tier (full or fast) per turn based on heuristic signals, then passes the appropriate `--model` flag to the `claude`/`codex` CLI.
- R2. **Plan phase downshift triggers:**
  - When the previous turn emitted `status: decided`, the responding agent's turn uses the fast model (it's likely confirming consensus).
  - When both agents have emitted at least one `decided` signal across the session (even if consensus was contested and resumed), subsequent turns use the fast model.
- R3. **Review phase downshift triggers:**
  - When the reviewer's first pass emits `verdict: approve`, any subsequent review turns (if the loop continues for other reasons) use the fast model.
  - Fix-request review turns (`verdict: fix`) always use the full model, since they require substantive analysis.
- R4. **Implementation phase is never downshifted** — always uses the full-capability model.
- R5. When a downshift occurs, DEF logs a visible indicator (e.g. `[fast]` tag in turn output or a log line like `Using fast model for confirmation turn`).
- R6. Downshifting is on by default. A CLI flag `--no-fast` disables it, forcing full-capability models for all turns.
- R7. Model tier mapping is configurable per agent. Default mappings:
  - `claude` full: (current default, likely opus/sonnet) / fast: `haiku`
  - `codex` full: (current default) / fast: TBD based on codex CLI capabilities
- R8. If a fast-model turn produces output that fails YAML frontmatter validation, DEF should retry that turn once with the full model before treating it as an error. This guards against cheaper models being less reliable at structured output.

## Success Criteria

- Confirmation/consensus turns complete faster and at lower cost than today
- No degradation in final output quality (decisions, implementation, reviews)
- Users can see when a fast model was used via logs

## Scope Boundaries

- **Not in scope:** Dynamic model selection based on token cost tracking or budget limits
- **Not in scope:** Letting the agent self-select its model tier
- **Not in scope:** Different model tiers within the implementation phase
- **Not in scope:** Per-topic or per-complexity model selection (all heuristics are phase/signal-based)

## Key Decisions

- **CLI flags over agent self-selection:** DEF controls the tier externally via `--model` flags, keeping model selection deterministic and observable.
- **Heuristic rules over turn-count thresholds:** Using semantic signals (`status: decided`, `verdict: approve`) is more precise than arbitrary turn numbers.
- **On by default with visibility:** Maximizes savings from day one while keeping users informed. `--no-fast` escape hatch available.
- **Retry fallback (R8):** Cheaper models may be less reliable at structured YAML output. One retry with the full model prevents false failures without silently hiding quality issues.

## Outstanding Questions

### Deferred to Planning

- [Affects R7][Needs research] What `--model` flag does the `codex` CLI accept, and what fast-tier model names are available?
- [Affects R1][Technical] Where in `agent.ts` should the model flag be injected — as an additional arg in `AgentConfig.args`, or as a new field on `AgentConfig`?
- [Affects R2][Technical] Should the heuristic state (e.g. "previous turn was decided") live in the orchestrator's turn loop or be extracted into a separate `ModelSelector` module?
- [Affects R5][Technical] Best way to surface the `[fast]` indicator in both CLI output and the React UI's turn cards.

## Next Steps

All questions are deferred to planning — no blockers remain.

-> `/ce:plan` for structured implementation planning
