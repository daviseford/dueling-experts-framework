---
date: 2026-03-23
topic: debate-then-implement
---

# Debate-Then-Implement: Full Decision-to-Execution Loop

## Problem Frame
DEF currently produces debate output and a decisions artifact, but stops there. Users must manually translate decisions into action. This defeats the purpose of an autonomous agent framework — the tool should close the loop from deliberation through execution.

## Requirements

- R1. **Three-phase session lifecycle**: Sessions progress through `debate → implement → review` phases. The orchestrator tracks the current phase in session state and enforces phase-specific behavior.

- R2. **Agent-signaled consensus**: An agent emits a new `decided` status when it believes consensus is reached. The other agent then either confirms (also emits `decided`) or contests (emits `complete`, returning to debate). Consensus requires both agents to agree.

- R3. **Implementation model selection via CLI**: A `--impl-model` flag (values: `claude`, `codex`; default: `claude`) sets which agent runs the implementation phase. Specified at session launch.

- R4. **Hybrid implementation execution**: The implementing agent produces structured text output describing changes to make (file writes, shell commands, etc.). DEF parses these instructions and executes a constrained set of operations — it never gives the agent direct filesystem access.

- R5. **Mandatory post-implementation review**: After implementation completes, the non-implementing agent reviews the changes. The reviewer can approve (emits `done`) or request fixes (emits `complete` with feedback).

- R6. **Fix loop until resolved**: If the reviewer requests fixes, the implementing agent gets another turn to address the feedback. This loops until the reviewer approves or a configurable turn limit is hit.

- R7. **General-purpose implementation**: Implementation is not limited to code changes. Agents can instruct file creation, documentation, command execution, or any task — scoped by the constrained operation set DEF supports.

## Success Criteria
- A session can progress from debate through implementation to review and completion without human intervention
- The user can specify `--impl-model codex` and have Codex run implementation while Claude reviews (or vice versa)
- The debate decisions are faithfully translated into the implementation prompt
- The review loop catches and resolves issues without requiring the user to intervene

## Scope Boundaries
- No interactive/tool-use agent mode — agents always produce text, DEF executes
- No mid-session model switching — implementation model is fixed at launch
- No human approval gate between phases (agents self-govern transitions; human can always interject via existing `needs_human` / UI mechanisms)
- The specific set of constrained operations DEF supports is deferred to planning

## Key Decisions
- **Agents signal consensus, not humans**: The debate phase is autonomous. Agents decide when they've reached agreement. Humans can still interject via the existing UI but aren't required to.
- **Hybrid execution model**: The implementing agent never directly touches the filesystem. It produces structured instructions; DEF executes them. This keeps DEF in control and allows sandboxing, logging, and auditability.
- **Always review**: Every implementation gets reviewed by the non-implementing agent. No skip option. The debate quality gate extends through execution.
- **Fix loop, not flag-and-stop**: The review/fix cycle repeats until the reviewer approves. A turn limit prevents runaway loops.

## Dependencies / Assumptions
- The rename from ACB to DEF (R1-R5 in `2026-03-23-rename-to-def-requirements.md`) should land first or in parallel — this builds on the DEF identity.
- Current turn schema (`status: complete | needs_human | done | error`) must be extended with `decided`.

## Outstanding Questions

### Resolve Before Planning
(none)

### Deferred to Planning
- [Affects R4][Needs research] What structured format should the implementing agent use for its instructions? (e.g., fenced code blocks with action annotations, a YAML action list, tool-call-like JSON)
- [Affects R4][Technical] What constrained operations should DEF support? (file write, file edit, shell command, mkdir — what else? What's excluded?)
- [Affects R6][Technical] What should the default turn limit for the review/fix loop be? (Separate from the debate turn limit)
- [Affects R2][Technical] How should contested consensus work? If Agent A says `decided` but Agent B contests, does the turn counter reset, or does the debate budget keep ticking?
- [Affects R1][Technical] How should session state represent the current phase? (New field in `session.json`, or derived from turn history?)

## Next Steps
→ `/ce:plan` for structured implementation planning
