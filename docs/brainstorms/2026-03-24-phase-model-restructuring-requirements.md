---
date: 2026-03-24
topic: phase-model-restructuring
---

# Phase Model Restructuring

## Problem Frame

DEF's current phase model treats "debate" as a generic opening phase in both planning and edit modes. In planning mode, debate produces only a decision log. In edit mode, debate transitions to implement (via fragile `def-action` blocks) and then single-agent review. This model has two problems:

1. **Planning mode produces no plan artifact.** The decision log captures individual decisions but not a cohesive plan that can guide future implementation.
2. **Edit mode lacks a structured pipeline.** The debate phase doesn't produce a plan that anchors implementation, and review is single-agent rather than collaborative.

The result is that implementation starts without a clear, agreed-upon plan, and review lacks the rigor of two agents challenging each other.

## Requirements

- R1. **Rename "debate" to "plan" phase.** The opening phase in both modes uses the same alternating-turn mechanics as today's debate, but is called "plan" and is oriented toward producing a plan rather than open-ended discussion. The `SessionPhase` type changes from `'debate' | 'implement' | 'review'` to `'plan' | 'implement' | 'review'`, updated in all consumers (orchestrator, context, session, recovery, UI).

- R2. **Plan phase produces two artifacts.** On consensus:
  - `decisions.md` — accumulated decisions across turns (as today)
  - `plan.md` — both `decided` turns concatenated (the proposing turn and the confirming/amending turn), written to disk in `artifacts/`

- R3. **Planning mode = plan phase only.** When mode is `planning`, the session runs the plan phase and stops after writing both artifacts. No implementation or review.

- R4. **Edit mode follows a plan → implement → review pipeline.**
  - Plan phase: both agents alternate until consensus (same mechanics as R1)
  - Implement phase: single native agent (usually Claude) executes with full tool access in an isolated worktree, guided by the plan
  - Review phase: both agents alternate turns debating the correctness of the implementation (same consensus mechanics as the plan phase)

- R5. **Review phase uses collaborative debate with explicit verdicts.** Both agents alternate turns examining the implementation's git diff (included in the review prompt context) and challenge each other's assessments. Agents include a `verdict: approve | fix` field in their YAML frontmatter. Consensus requires both agents to emit `decided` with the same verdict. Mismatched verdicts (one says `approve`, one says `fix`) = contested consensus, review debate continues.

- R6. **Implement/review loop.** When review consensus verdict is `fix`, the session transitions back to implement. The implementing agent receives full history: the original plan, previous implementation context, and review feedback. `--review-turns` counts loop iterations (not individual turns within a review round). This loop repeats until review verdict is `approve` or the max review turns limit is reached.

- R7. **Implement phase uses native agent execution.** The implementing agent runs with full tool access (not `--print` mode), directly modifying files in the worktree. The orchestrator detects completion by process exit, bypasses frontmatter validation, captures `git diff` as the turn content, and records a synthetic turn with orchestrator-assigned metadata. (See: `2026-03-24-native-agent-execution-requirements.md`)

- R8. **Human interjection supported in plan and review phases.** Both collaborative phases (plan and review) support human interjection via the watcher UI. Interjections are dropped only during the implement phase (single-agent, full tool access).

- R9. **Session completion output includes plan artifact path.** When a session completes (either mode), the output includes the path to `plan.md` alongside existing output (branch, turns directory, artifacts directory).

- R10. **Graceful degradation when plan phase exhausts max_turns.** If agents reach `max_turns` without consensus, the orchestrator writes a `decisions.md` from whatever decisions were captured (if any) but does not write `plan.md`. The session ends with a clear "no consensus reached" status. No transition to implement occurs. The turn history is preserved for the user to review and re-run.

## Success Criteria

- Planning mode sessions produce a `plan.md` artifact alongside the decision log
- Edit mode sessions follow the plan → implement → review pipeline without falling back to the old debate model
- Review phase involves both agents alternating turns with explicit `verdict` fields, not just the non-implementing agent
- The implement/review loop functions correctly, with the implementing agent receiving full context on each iteration
- The plan artifact written to disk is used as input context for the implementing agent
- Human interjection works in both plan and review phases

## Scope Boundaries

- **Not changing the alternating-turn consensus mechanics themselves.** The underlying turn-taking and `decided` signaling stay the same.
- **Not changing agent invocation for plan/review phases.** These remain in `--print` mode. Only implement phase uses native execution.
- **Not defining the plan artifact's internal structure.** The plan is the raw concatenation of both `decided` turns, not a reformatted/structured document.
- **`def-action` removal is a separate concern.** Covered by the native agent execution requirements doc.
- **Plan artifact remains static after creation.** The original plan is not updated during fix loops. Review turns and fix history serve as the living record of deviations.

## Key Decisions

- **Same mechanics, different framing:** The plan phase reuses today's debate alternating-turn logic. No new consensus algorithm needed — just rename and reorient the prompts.
- **Two artifacts, not one:** Decision log captures granular decisions; plan captures the holistic consensus. Both are useful for different purposes.
- **Plan = both decided turns concatenated:** Captures the substantive proposal and any amendments from the confirming agent, avoiding thin "I agree" artifacts.
- **Collaborative review over single-agent review:** Review benefits from the same adversarial dynamic as planning. Two agents catch more issues than one.
- **Explicit verdict field over status overloading:** Review agents include `verdict: approve | fix` in frontmatter. Clearer than repurposing existing status values for dual meaning.
- **Full history on fix loops:** When looping back to implement, the agent gets everything (plan + prior impl + review feedback) rather than a trimmed context. The existing context budget system handles truncation if needed.
- **Loop iteration counting for review-turns:** `--review-turns` counts implement→review loop iterations, not individual agent turns within a review round. Consistent with intent of the limit as a safety valve on fix loops.
- **Human interjection in collaborative phases:** Both plan and review support human interjection. Only implement (single-agent, full tools) drops interjections.

## Dependencies / Assumptions

- Depends on worktree isolation (partially implemented on current branch)
- Depends on native agent execution (requirements in `2026-03-24-native-agent-execution-requirements.md`)
- Assumes the existing context budget system (400K char, oldest-first truncation) can handle the full-history approach for fix loops
- Recovery code must handle both old `debate` and new `plan` phase names for backward compatibility with pre-migration sessions

## Outstanding Questions

### Deferred to Planning

- [Affects R4][Technical] How should the review prompt template present the git diff to collaborative reviewers? Needs a new prompt builder distinct from today's single-agent `reviewPrompt()`.
- [Affects R6][Technical] On fix loops, should reviewers see the cumulative diff (all changes from branch point) or incremental diff (only latest fixes)? Cumulative seems right for full-picture review but may hit context budget limits.
- [Affects R7][Needs research] How does the native agent receive the plan as context when invoked without `--print`? Need to investigate prompt delivery methods for interactive agent modes (e.g., does piping to stdin trigger tool use for `claude` without `--print`?).
- [Affects R7][Technical] How should the implement phase's synthetic turn be structured? Needs orchestrator-assigned frontmatter and diff-as-body format.

## Next Steps

→ `/ce:plan` for structured implementation planning
