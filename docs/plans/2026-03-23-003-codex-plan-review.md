# Plan Review

- [P1] `decisions` is both optional and required. `Canonical Turn Schema` marks `decisions` as optional, but `Context Assembly` says it is one of the "Required frontmatter fields," `Protocol Clarifications` says it is "Required, always an array," and Phase 1 validation/acceptance still treat it as optional. Conflicting sections: `Canonical Turn Schema` vs `Protocol Clarifications` / `Phase 1: Core Loop + Resilience Basics`.

- [P1] `final-summary.md` is simultaneously removed and still required. `Artifact generation` says "No final-summary.md in v1," and `Simplifications Applied` says `final-summary.md` was removed, but `Proposed Solution` and top-level `Acceptance Criteria` still require a final summary artifact at session end. Conflicting sections: `Proposed Solution` / `Acceptance Criteria` vs `Artifact generation` / `Simplifications Applied`.

- [P1] The 100K context guard/truncation logic is both required and removed. `Enhancement Summary`, `Proposed Solution`, `Context Assembly`, `Acceptance Criteria (R3)`, `Risk Analysis`, and `Architecture Notes` all depend on a 100K guard, but Phase 1 `src/context.js` says "no truncation needed" and `Simplifications Applied` says "100K truncation logic" was removed. Conflicting sections: `Context Assembly` / `Acceptance Criteria` vs `Phase 1: Core Loop + Resilience Basics` / `Simplifications Applied`.

- [P2] The `runtime/` layout disagrees on whether temp files are shared or per-agent. `Session Directory Layout` shows a single `runtime/prompt.md` and `runtime/output.md`, and Phase 1 `src/agent.js` uses those shared paths, but `Agent Invocation` uses `runtime/claude/prompt.md` and `runtime/codex/output.md`. Conflicting sections: `Session Directory Layout` / `Phase 1: Core Loop + Resilience Basics` vs `Agent Invocation`.

- [P2] Phase 1 still references a removed artifact module. The `src/index.js` pseudocode says "On completion, call `artifacts.generate(session)`," but the plan later says artifact generation is inline and `src/artifacts.js` was removed. Conflicting sections: `Phase 1: Core Loop + Resilience Basics` vs `Artifact generation` / `Simplifications Applied`.

- [P2] Duplicate interjection rejection is both present and removed. The `/api/interject` contract says it "Rejects consecutive identical content," and `Frontend Reliability` keeps the same server-side rule, but `Simplifications Applied` says duplicate interjection rejection was removed. Conflicting sections: `Watcher UI` / `Frontend Reliability` vs `Simplifications Applied`.

- [P2] Optimistic interjection rendering is both specified and removed. `Protocol Clarifications`, Phase 2 `src/ui/index.html`, and `Frontend Reliability` all still describe optimistic rendering of interjections, but `Simplifications Applied` says that behavior was removed. Conflicting sections: `Protocol Clarifications` / `Phase 2: Watcher UI + Human-in-the-Loop` / `Frontend Reliability` vs `Simplifications Applied`.

- [P2] The `visibilitychange` polling behavior is both required and removed. Phase 2 `src/ui/index.html` and `Frontend Reliability` still require a `document.visibilitychange` handler, but `Simplifications Applied` says that handler was removed. Conflicting sections: `Phase 2: Watcher UI + Human-in-the-Loop` / `Frontend Reliability` vs `Simplifications Applied`.

- [P2] The end-session endpoint name is inconsistent. The architecture diagram lists `/api/end`, but the API contract, server pseudocode, and task list use `/api/end-session`. Conflicting sections: `Architecture` vs `Watcher UI` / `Phase 2: Watcher UI + Human-in-the-Loop`.

- [P2] The pause banner trigger is described two different ways. `Watcher UI` says the yellow banner appears when `session_status` is `paused`, but Phase 2 `src/ui/index.html` says it appears when the latest turn has `status: needs_human`. Conflicting sections: `Watcher UI` vs `Phase 2: Watcher UI + Human-in-the-Loop`.

- [P2] Recovery still depends on a removed lockfile PID feature. `Concurrency & Port Rules` describes a plain `.acb/lock` file that blocks startup until manually deleted, and `Simplifications Applied` says "Lockfile PID check + --force" was removed, but Phase 3 recovery pseudocode still says to check whether the lockfile PID is alive. Conflicting sections: `Concurrency & Port Rules` / `Simplifications Applied` vs `Phase 3: Crash Recovery`.

- [P2] The 500KB output guard is both required and removed. `Security Hardening` still mandates "Max output size 500KB," but `Simplifications Applied` says the 500KB output guard was removed. Conflicting sections: `Security Hardening` vs `Simplifications Applied`.
