---
date: 2026-03-23
topic: agent-collab-hybrid
---

# Agent Collaboration: Hybrid Document Handoff

## Problem Frame

Multi-agent workflows between Claude Code and Codex are currently manual: copy context from one agent, paste into the other, repeat. There is no structured way for two agents to reason back and forth on a problem, and no way to observe the exchange or interject as it happens.

The original PRD proposed a real-time WebSocket message bus. This revision adopts a simpler document handoff architecture that works with existing CLI tools and subscriptions, paired with a lightweight watcher UI for observation and human interjection.

## Requirements

- R1. **Orchestrated turn-based conversation:** An orchestrator script invokes Claude Code and Codex CLIs alternately, each reading prior turns and producing one response per turn. Turns continue until a configured limit, an agent signals session completion, or a human ends the session.
- R2. **Structured handoff files:** Each canonical turn is stored as a markdown file with YAML frontmatter. Required fields are `id`, `turn`, `from`, `timestamp`, `status`, and `decisions`. Optional fields are `response_to` and `error_detail`. The body is the turn content in markdown.
- R3. **Context management:** The orchestrator assembles context for each agent invocation from: (a) the session brief and role prompt, (b) a running summary, (c) a bounded window of recent turn files, and (d) any attached reference material (files, diffs, code). v1 does not resend the full transcript on every turn.
- R4. **Human interjection:** Davis can inject a turn at any point, either via the watcher UI or by manually creating a handoff file. Interjections received during an active agent turn are queued and injected at the next turn boundary in FIFO order.
- R5. **Human escalation:** When an agent sets `status: needs_human` in its handoff frontmatter, the orchestrator pauses and waits for a human response before continuing.
- R6. **Watcher UI:** A lightweight local web page renders turns as they appear and provides a text input for human interjection via the orchestrator's local HTTP interface. v1 uses a static HTML page plus a tiny local HTTP server with polling; no framework required.
- R7. **Session artifacts:** At session end, the orchestrator generates a `decisions.md` file by extracting all `decisions` entries from canonical turns, and a `final-summary.md` via a post-session CLI synthesis step by default. Direct API synthesis is optional later, not required for v1.
- R8. **Agent role differentiation:** System prompts for each agent define distinct responsibilities per session mode. In `planning` mode, Claude owns architecture and product reasoning; Codex owns implementation feasibility and technical trade-offs.
- R9. **CLI subprocess invocation:** Agents are invoked via their CLIs in non-interactive mode. Claude: `claude --print -m "prompt"`. Codex: `codex exec "prompt" --full-auto -o <output-path>`. Prompts should stay short; rich context lives on disk. System prompts for Codex are injected via a dynamically written `AGENTS.md` file inside an isolated per-session working directory and rewritten before each Codex turn.
- R10. **Orchestrator-owned canonical files:** The orchestrator, not the agent, owns canonical turn filenames and schema validation. Agents write to temporary output paths; the orchestrator validates, normalizes, and persists the canonical handoff file.
- R11. **Deterministic turn resumption:** If an agent escalates with `status: needs_human`, the human response is recorded as the next turn and control returns to the same agent that escalated unless the human explicitly redirects the next speaker.
- R12. **Per-session isolation:** Each session runs in its own working directory containing session state, temporary prompt/context files, and any dynamic `AGENTS.md` file to avoid cross-session prompt leakage or file races.
- R13. **Failure visibility:** Invalid agent output, CLI failures, and timeouts are recorded as canonical `error` turns written by the orchestrator and surfaced in the watcher UI.

## Success Criteria

- Two agents can complete a 10+ turn planning conversation with minimal human intervention, producing a usable plan
- Davis can observe the conversation in near-real-time via the watcher UI
- Davis can interject at any turn boundary and both agents incorporate his input
- `status: needs_human` pauses the loop and waits for Davis
- The system works with existing Claude Code and Codex CLI installations without additional API billing in v1

## Scope Boundaries

- **Not a real-time streaming system** - turns are atomic; no token-by-token rendering
- **Not a general orchestration framework** - two agents, turn-based, single machine
- **No persistent agent state** - each CLI invocation is independent; context comes from orchestrator-managed files
- **v1 supports `planning` mode only** - `code_review` and `debate` are deferred
- **No cloud/remote** - local-only, same machine

## Key Decisions

- **Document handoff over WebSocket bus:** Simpler, works with existing CLIs, avoids API billing. Trades real-time streaming for simplicity and compatibility.
- **CLI subprocess over direct API:** Preserves existing subscription billing (ChatGPT Pro for Codex, Claude Code subscription for Claude). Avoids separate API key setup and pay-per-token costs in v1.
- **Polling watcher UI over fs.watch:** On Windows, 3-second polling via a tiny local HTTP server is simpler and more reliable than filesystem watch events.
- **Frontmatter signals over in-band tokens:** `status`, `decisions`, and error signals live in structured YAML frontmatter, not parsed from natural language. More reliable and easier to validate.
- **Per-session working directory:** Dynamic prompts and temporary files live under one session-scoped directory so concurrent sessions cannot overwrite each other's state.
- **Orchestrator validation over agent-written canonicals:** Agents produce content; the orchestrator decides canonical filenames, validates required fields, and rejects malformed output.
- **One retry then pause:** Each failed turn gets one automatic retry. If the retry fails, the orchestrator writes a canonical `error` turn and pauses for human input.

## Dependencies / Assumptions

- **Claude Code CLI** supports non-interactive mode with `claude --print -m "prompt"` (confirmed)
- **Codex CLI** supports non-interactive mode via `codex exec "prompt"` (confirmed via research):
  - `codex exec --json` emits JSONL events to stdout (parseable if later needed)
  - `-o <path>` / `--output-last-message <path>` writes the final response to a file
  - `--full-auto` suppresses approval prompts (combines `--ask-for-approval never` + workspace-write sandbox)
  - `codex exec resume --last "prompt"` resumes a prior session
  - **No `--system-prompt` flag** - must use `AGENTS.md` files on the filesystem
  - **No stdin-as-prompt** - prompts must be CLI args, so rich context should live in files on disk
  - `AGENTS.md` behavior should be treated as process-start scoped, so the orchestrator must write it before invoking `codex exec`
- File watching alone is not sufficient for human interjection; a tiny local server/process is required
- On the target machine, polling is preferred over `fs.watch` for v1 due to Windows filesystem-watch reliability issues

## Phase 1 Defaults

- **Canonical schema required fields:** `id`, `turn`, `from`, `timestamp`, `status`, `decisions`
- **Canonical schema optional fields:** `response_to`, `error_detail`
- **Canonical turn status values:** `complete`, `needs_human`, `done`, `error`
- **`decisions` field rule:** always an array, including `[]` when there are no decisions
- **`response_to` rule:** references a turn id, not a turn number or file path
- **Context policy:** `session.md` brief + `summary.md` running summary + last 4 canonical turns + attached references
- **Turn resumption after escalation:** resume with the same agent that raised `status: needs_human`, unless the human sets an explicit override
- **Session completion rule:** an agent sets `status: done` when it believes the collaboration is complete; the orchestrator ends unless a human continues the session
- **Human interjection queue rule:** queue interjections received during a running turn and process them one at a time at turn boundaries
- **Watcher UI transport:** static HTML served by the orchestrator plus `GET /api/turns`, `GET /api/session`, `GET /api/status`, and `POST /api/interject`
- **Watcher UI poll interval:** 3 seconds
- **Watcher UI scope:** transcript view, labels, timestamps, paused-state banner, and interject input only
- **Session layout:** `sessions/<id>/session.md`, `sessions/<id>/summary.md`, `sessions/<id>/turns/`, `sessions/<id>/artifacts/`, `sessions/<id>/attachments/`, `sessions/<id>/runtime/claude/`, `sessions/<id>/runtime/codex/`
- **Runtime rule:** canonical turn files are immutable once written; `runtime/` is ephemeral and safe to delete after completion

## Planning Mode Role Prompts

### Claude

```text
You are Claude, one of two AI agents in a structured planning session. The other
agent is Codex. A human operator (Davis) is observing and may interject.

SESSION TOPIC: {{TOPIC}}

YOUR RESPONSIBILITIES:
- Own the high-level architecture: system boundaries, component relationships,
  data flow, and integration points
- Evaluate product implications: does this approach serve the user well? Are
  there simpler framings?
- Identify scope risks: what is being over-built, under-specified, or deferred
  without justification?
- Produce concrete proposals, not abstract options. State your recommendation
  and why.

WHAT YOU CHALLENGE CODEX ON:
- Implementation proposals that add unnecessary complexity or carrying cost
- Premature optimization or over-engineering
- Missing error cases or failure modes
- Approaches that solve the technical problem but miss the user problem

WHEN TO ESCALATE TO DAVIS:
- Product decisions that require user or stakeholder judgment
- Scope trade-offs where you and Codex disagree after one exchange
- Ambiguity in requirements that neither agent can resolve

CONVERSATION RULES:
- Be direct and concise. This is a dialogue, not a monologue.
- Do not restate what was already said. Build on it or challenge it.
- Disagree openly when you have a better approach.
- When you reach a notable decision, add it to the decisions array in your
  response frontmatter.
- When you believe the planning objective is met, set status: done.
- If you need Davis's input, set status: needs_human and explain what you need.
```

### Codex

```text
You are Codex, one of two AI agents in a structured planning session. The other
agent is Claude. A human operator (Davis) is observing and may interject.

SESSION TOPIC: {{TOPIC}}

YOUR RESPONSIBILITIES:
- Own implementation feasibility: can this actually be built as proposed? What
  are the real constraints?
- Evaluate technical trade-offs: performance, maintainability, dependency cost,
  and operational complexity
- Identify concrete implementation risks: what will be harder than it looks?
  What has hidden dependencies?
- Propose specific technical approaches with rationale, not just concerns

WHAT YOU CHALLENGE CLAUDE ON:
- Architecture proposals that sound clean but are impractical to implement
- Scope that is too ambitious for the stated constraints
- Abstractions that add indirection without clear payoff
- Assumptions about library or API capabilities that may not hold

WHEN TO ESCALATE TO DAVIS:
- Resource or timeline constraints that affect feasibility
- Technical choices that have significant cost or vendor implications
- Cases where both approaches are viable and the trade-off is a preference call

CONVERSATION RULES:
- Be direct and concise. This is a dialogue, not a monologue.
- Do not restate what was already said. Build on it or challenge it.
- Disagree openly when you have a better approach.
- When you reach a notable decision, add it to the decisions array in your
  response frontmatter.
- When you believe the planning objective is met, set status: done.
- If you need Davis's input, set status: needs_human and explain what you need.
```

## Failure Handling Rules

- **Agent output file missing:** log the failure, retry once, then write a canonical `error` turn and pause for human input
- **Output file exists but frontmatter is invalid:** log validation errors, retry once, then write a canonical `error` turn preserving raw output and pause for human input
- **Output is empty:** treat as missing output; retry once, then write a canonical `error` turn and pause for human input
- **CLI exits nonzero:** log exit code and stderr, retry once, then write a canonical `error` turn with failure details and pause for human input
- **Turn exceeds timeout:** kill the agent process, retry once, then write a canonical `error` turn and pause for human input
- **Human interjection is malformed:** reject via HTTP 400 and do not persist a turn
- **Orchestrator crashes mid-turn:** on restart, resume from the last canonical turn; discard incomplete runtime output

## Outstanding Questions

### Resolve Before Planning

- None. The phase-1 protocol and architecture are locked well enough to plan implementation.

### Resolved

- ~~[Affects R2][Technical] Exact canonical schema~~ - **Resolved:** required fields are `id`, `turn`, `from`, `timestamp`, `status`, and `decisions`; optional fields are `response_to` and `error_detail`
- ~~[Affects R5][Product] `needs_human` signaling~~ - **Resolved:** use `status: needs_human`; no separate boolean field
- ~~[Affects R6][Technical] Watcher UI transport~~ - **Resolved:** static HTML + tiny local HTTP server + 3-second polling, not `fs.watch`
- ~~[Affects R8][Design] Initial role prompts~~ - **Resolved:** planning-mode role prompts are locked for Claude and Codex
- ~~[Affects R9][Technical] Working-directory strategy~~ - **Resolved:** isolated per-session layout with separate `runtime/claude/` and `runtime/codex/`; rewrite `AGENTS.md` before each Codex turn
- ~~[Affects failures][Technical] Error handling model~~ - **Resolved:** one retry, then canonical `error` turn + human pause

### Deferred to Planning

- [Affects R3][Needs research] What is the optimal context window strategy beyond the phase-1 default? How large can the recent-turn window grow before CLI usability degrades?
- [Affects R7][Technical] Should post-session synthesis remain CLI-based long term, or should a direct API path be added later for more control?
- [Affects R2][Technical] Should canonical turn files include additional provenance fields such as `model`, `duration_ms`, or token or usage metadata?
- [Affects product][Design] What future UI affordances should be added after transcript + interjection are working?
- [Affects modes][Design] What specific role assignments work best for future modes beyond `planning`?

## Reference Invocation Pattern

```bash
# Prepare isolated session working directory and write dynamic system prompt
echo "You are Codex in a collaborative session..." > sessions/<id>/runtime/codex/AGENTS.md

# Invoke Codex for one turn from that working directory
codex exec "Read the session files and respond in markdown with YAML frontmatter" --full-auto -o sessions/<id>/runtime/codex/output.md

# Invoke Claude with a short prompt and file-based session context
claude --print -m "Read the session files and respond in markdown with YAML frontmatter"

# Orchestrator validates and persists canonical turn files
# sessions/<id>/turns/turn-0004-codex.md
```

## Next Steps

-> Proceed to `/ce:plan` for implementation planning with the locked phase-1 protocol above.
