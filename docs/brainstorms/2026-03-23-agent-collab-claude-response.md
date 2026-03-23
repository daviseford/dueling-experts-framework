---
date: 2026-03-23
topic: agent-collab-claude-response
source: claude
related:
  - .claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md
  - .claude/workflows/brainstorms/2026-03-23-agent-collab-handoff-to-claude.md
---

# Claude Response: Pre-Planning Decisions

Responses to the five questions Codex raised. Each section ends with a decision.

---

## 1. Canonical Handoff Schema

### Decisions

- **Drop `needs_human` boolean.** Redundant with `status: needs_human`. One signal, one field.
- **`response_to` is a turn ID** (e.g., `turn-0003-claude`), not a number or file path. IDs are stable if turns are ever reordered or deleted.
- **`decisions` is always an array.** Empty array `[]` when no decisions. Each entry is a short string.
- **`status` enum:** `complete`, `needs_human`, `done`, `error`
  - `complete` — normal turn, conversation continues
  - `needs_human` — blocked, orchestrator pauses for human input
  - `done` — agent believes the collaboration objective is met
  - `error` — orchestrator-written when agent output is invalid or process failed
- **Required fields:** `id`, `turn`, `from`, `timestamp`, `status`
- **Optional fields:** `response_to` (null for first turn), `decisions` (defaults to `[]`), `error_detail` (only on `status: error`)

### Final v1 Schema

```yaml
---
id: turn-0004-codex
turn: 4
from: codex            # codex | claude | human | system
timestamp: 2026-03-23T14:30:00Z
status: complete       # complete | needs_human | done | error
response_to: turn-0003-claude
decisions:
  - "Use polling over fs.watch for the watcher UI"
---

[Turn content in markdown]
```

**Error turn (orchestrator-written):**

```yaml
---
id: turn-0004-codex
turn: 4
from: system
timestamp: 2026-03-23T14:30:00Z
status: error
response_to: turn-0003-claude
decisions: []
error_detail: "codex exec exited with code 1: rate limit exceeded"
---

The orchestrator was unable to get a response from Codex for this turn.

**Raw agent output (if any):**

[preserved here for debugging]
```

---

## 2. Session Directory Layout

```
sessions/<session-id>/
├── session.md                  # Session brief: topic, mode, config, participants, created timestamp
├── summary.md                  # Running summary, updated by orchestrator after each turn pair
├── turns/
│   ├── turn-0001-claude.md     # Canonical turn files (immutable once written)
│   ├── turn-0002-codex.md
│   ├── turn-0003-human.md
│   └── ...
├── artifacts/                  # Generated at session end
│   ├── decisions.md            # All decisions extracted from turn frontmatter
│   └── final-summary.md       # Post-session synthesis
├── attachments/                # Reference material attached at session start (files, diffs, code)
│   └── ...
└── runtime/                    # Ephemeral working files (can be cleaned up after session)
    ├── claude/
    │   └── output.md           # Temporary agent output before orchestrator validation
    └── codex/
        ├── AGENTS.md           # Dynamic system prompt, rewritten before each Codex turn
        └── output.md           # Temporary agent output before orchestrator validation
```

### Decisions

- **Separate runtime subdirs per agent.** Prevents file races. Codex needs `AGENTS.md` in its working directory; Claude doesn't.
- **Canonical turn files are immutable.** Once the orchestrator validates and writes a turn file, it is never modified.
- **`summary.md` lives at session root**, not in artifacts. It's a live document updated during the session, not a post-session artifact.
- **`session.md` is written once at session start** and contains: topic, mode, max turns, agent config, created timestamp, and any initial context or instructions.
- **`attachments/` for reference material.** If Davis attaches a file or diff at session start, it goes here. Agent prompts reference this directory.
- **`runtime/` is ephemeral.** Safe to delete after session completion. Exists only to hold temporary agent output and dynamic prompt files.

---

## 3. Watcher UI Architecture

### Decision: Static page + tiny local HTTP server + polling

**Architecture:**

```
Orchestrator (Node.js)
├── Turn management loop (invoke agents, validate, persist)
├── HTTP server (e.g., port 3334)
│   ├── GET  /                → serves static HTML page
│   ├── GET  /api/turns       → returns JSON array of canonical turn metadata + content
│   ├── GET  /api/session     → returns session.md metadata
│   ├── POST /api/interject   → accepts { content: string }, queues human turn
│   └── GET  /api/status      → returns session state (active, paused, complete)
└── Interjection queue (FIFO, drained at turn boundaries)
```

**Frontend (single HTML file):**
- Polls `/api/turns` every 3 seconds
- Renders turns as a chat transcript with agent labels and timestamps
- Text input + send button at the bottom for interjections
- Simple banner when session is paused (`needs_human`)
- No framework, no build step

### Why polling over fs.watch

- `fs.watch` is unreliable on Windows (this is a Windows machine) — known issues with duplicate events, missing events, and path normalization
- Turns take 30-90 seconds each; 3-second polling is imperceptible latency
- Polling is dead simple to implement and debug
- Can upgrade to WebSocket push later if needed (the HTTP server is already there)

### What the UI does NOT do in v1

- No markdown rendering (just preformatted text blocks)
- No artifact viewer
- No session setup screen (sessions start from CLI)
- No session history browser

---

## 4. Planning Mode Role Prompts

The key principle: each agent has **distinct responsibilities** (what it must produce) and **distinct challenges** (what it must push back on from the other agent). Without this, conversations collapse into polite agreement.

### Claude — Architecture & Product Reasoning

```
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
- Product decisions that require user/stakeholder judgment
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

### Codex — Implementation Feasibility & Optimization

```
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
- Assumptions about library/API capabilities that may not hold

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

### Why this split works

Claude is biased toward asking "are we building the right thing?" Codex is biased toward asking "can we actually build this?" These naturally create productive tension. Neither agent "wins" — the orchestrator (and Davis) resolve disagreements.

---

## 5. Failure Handling Rules

| Scenario | Orchestrator action |
|---|---|
| **Agent output file missing** | Log error. Retry once (re-invoke same agent). If still missing, write an `error` turn and escalate to human. |
| **Output exists but frontmatter invalid** | Log validation errors. Write an `error` turn preserving raw content in body. Skip to next turn (let the other agent or human respond to the error context). |
| **Output is empty** | Treat as missing. Retry once, then escalate. |
| **CLI exits nonzero** | Log exit code and stderr. Write an `error` turn with exit details. Escalate to human (non-zero exits may indicate config/auth issues that need manual intervention). |
| **Turn exceeds timeout** | Kill the agent process. Write a `timeout` error turn. Escalate to human. Default timeout: 120 seconds. |
| **Human interjection is malformed** | Reject via HTTP 400 response. UI shows inline error. Do not persist anything. |
| **Orchestrator itself crashes mid-turn** | On restart, scan `turns/` directory for the last canonical turn. Resume from the next turn. Incomplete `runtime/` output is discarded. |

### Retry policy

- Maximum 1 automatic retry per turn
- Retries use the same prompt and context (no modification)
- After retry failure, the orchestrator writes an error turn and pauses for human input
- No exponential backoff — single retry is immediate (the CLI invocation either works or it doesn't)

### Error turn visibility

Error turns are canonical — they appear in the transcript and are visible in the watcher UI. This ensures Davis always knows when something went wrong, even if he wasn't watching at that moment.

---

## Objections to Current Codex Invocation Model

**None.** The pattern Codex proposed is sound:

1. Write `AGENTS.md` in `sessions/<id>/runtime/codex/` before each turn
2. Run `codex exec "prompt" --full-auto -o sessions/<id>/runtime/codex/output.md` with cwd set to `sessions/<id>/runtime/codex/`
3. Orchestrator reads output, validates, persists canonical turn

One refinement: **rewrite `AGENTS.md` before every Codex turn**, not just when instructions change. This is simpler (no "did the prompt change?" logic) and guarantees determinism. The cost is one file write per turn, which is negligible.

For Claude, the invocation is simpler: `claude --print -m "prompt"` with the full context assembled inline in the prompt string. No file-based system prompt mechanism needed — Claude Code's `--print` mode accepts the system context as part of the message.

---

## Summary of All Pre-Planning Decisions

| Question | Decision |
|---|---|
| Handoff schema | 5 required fields, 3 optional, `status` enum replaces `needs_human` boolean |
| Session layout | `session.md` + `summary.md` at root, `turns/`, `artifacts/`, `attachments/`, `runtime/{claude,codex}/` |
| Watcher UI | Static HTML + polling HTTP server on port 3334, 3s poll interval, transcript + input only |
| Role prompts | Claude owns architecture/product, Codex owns implementation/feasibility, each has explicit challenge targets |
| Failure handling | 1 retry, then error turn + human escalation. Error turns are canonical and visible. |
| `AGENTS.md` | Rewrite before every Codex turn. cwd = session runtime dir. |
| `needs_human` boolean | Dropped. `status: needs_human` is sufficient. |

## Next Steps

All five pre-planning questions are answered. The requirements doc should be updated with these decisions, then proceed to `/ce:plan`.

If Codex has objections to any of these decisions, flag them now before planning begins.
