---
title: "feat: Agent Collaboration Hybrid Document Handoff"
type: feat
status: active
date: 2026-03-23
origin: .claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md
---

# Agent Collaboration: Hybrid Document Handoff

## Enhancement Summary

**Deepened on:** 2026-03-23
**Sections enhanced:** Architecture, Security, Performance, Simplicity, Frontend Reliability
**Research agents used:** 6 (Architecture Strategist, Security Sentinel, Performance Oracle, Code Simplicity Reviewer, Frontend Races Reviewer, Best Practices Researcher)

### Key Improvements
1. Move timeout enforcement to Phase 1 — prevents blocked development during build
2. Drop running summary for v1 — eliminates 10 extra CLI calls per session at 20-turn scale
3. Merged 5 phases into 3 — Phase 1 is headless core loop (with timeouts + artifacts), Phase 2 adds UI + interjection, Phase 3 is crash recovery
4. Add security hardening before Phase 2 — CORS, CSRF, 127.0.0.1 binding, no shell:true
5. Fix 4 high-severity frontend race conditions — recursive setTimeout, merge status+turns endpoint, debounce send

### New Considerations Discovered
- Orchestrator should own all turn numbering and filenames (agents don't control their own IDs)
- Runtime state split into `state.json` (mutable) separate from `session.md` (immutable)
- Concurrent sessions resolved: lockfile per repo + dynamic port assignment
- Phase 1 context assembly has a 100K char size guard to prevent prompt overflow

## Overview

Build a local orchestrator that enables structured, turn-based conversations between Claude Code and Codex CLIs. The orchestrator manages turn order, validates agent output, assembles context, and serves a lightweight watcher UI for human observation and interjection. All state lives in files on disk — no databases, no WebSockets, no external services.

This replaces the original WebSocket message bus PRD with a simpler document handoff architecture that works with existing CLI subscriptions (see origin: `.claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md`).

## Problem Statement

Multi-agent workflows between Claude Code and Codex are currently manual: copy context from one, paste into the other, repeat. There is no structured way for two agents to reason back and forth, and no way to observe the exchange or interject as it happens.

## Proposed Solution

A Node.js orchestrator that:
1. Creates an isolated session directory per conversation
2. Alternately invokes Claude Code and Codex CLIs in non-interactive mode
3. Validates each agent's output against a canonical YAML frontmatter schema
4. Persists validated turns as immutable markdown files
5. Assembles context (session brief + all prior turns, with a 100K char size guard) for each invocation
6. Serves a static HTML watcher UI via a tiny HTTP server with 3-second polling
7. Accepts human interjections via HTTP POST, queuing them for the next turn boundary
8. Handles escalation (`status: needs_human`), errors, timeouts, and retries
9. Generates session artifacts (decisions log, final summary) at session end

## Portability Model

### Installation

The orchestrator lives in its own standalone repo, cloned once to a permanent location:

```bash
git clone <repo-url> ~/tools/agent-collab
cd ~/tools/agent-collab && npm install
```

A `bin/acb` CLI entry point is added to PATH (via shell profile or symlink). The orchestrator code is never copied into target repos.

### Invocation

Run `acb` from any repo directory. The target repo is always `process.cwd()`:

```bash
cd ~/Projects/kinetic-xyz
acb --topic "Plan Phantom wallet deep-link support"
```

### Session Storage

Sessions are stored inside the target repo at `.acb/sessions/<id>/`. This keeps session data co-located with the code being discussed. The `.acb/` directory should be added to `.gitignore`.

```
target-repo/
├── .acb/                        # Created on first use
│   └── sessions/
│       └── 2026-03-23-abc123/
│           ├── session.md
│           ├── turns/
│           ├── artifacts/
│           └── runtime/
├── src/
└── .gitignore                   # includes .acb/
```

### Concurrency & Port Rules

- **One session per repo at a time.** On startup, the orchestrator creates a lockfile at `.acb/lock`. If the lockfile already exists and the PID in it is still alive, `acb` exits with an error: `"Another session is already running in this repo (PID <N>). Use --force to override."`
- **Dynamic port.** The HTTP server binds to `127.0.0.1:0` (OS-assigned port). The actual port is written to `state.json` and printed to the CLI: `Watcher UI: http://localhost:<port>`. No hardcoded port means no conflicts between sessions in different repos.
- **Multiple repos can run simultaneously** — each has its own `.acb/lock` and its own dynamically assigned port.

### Agent Repo Access

Both agents are invoked with cwd = target repo, so they can read and navigate the codebase. This changes the Codex invocation model:

- **Claude:** `claude --print -p prompt.md` (or via stdin) runs from target repo cwd. **Known limitation:** Claude Code will load the target repo's `CLAUDE.md` if one exists. This is accepted for v1 because project-level instructions provide useful context (conventions, patterns). The session role prompt is explicit about output format (YAML frontmatter) and takes priority. If contamination proves problematic in practice, a future version can invoke Claude from an isolated cwd or investigate suppression flags.
- **Codex:** `codex exec --full-auto --no-project-doc -o <output-path> < prompt.md` runs from target repo cwd. The full assembled prompt (role + context) is piped via stdin redirection, bypassing OS arg-length limits. `--no-project-doc` prevents loading the repo's existing `AGENTS.md`.

> **Why `--no-project-doc`?** Without it, Codex would merge its own project-level `AGENTS.md` with our session role prompt, causing confusion. By suppressing automatic loading, we have full control over what instructions Codex receives per turn.

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────┐
│                 Orchestrator                     │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │  Turn     │  │  Context  │  │  Validation  │  │
│  │  Manager  │  │  Builder  │  │  Engine      │  │
│  └────┬─────┘  └─────┬────┘  └──────┬───────┘  │
│       │              │              │           │
│  ┌────▼──────────────▼──────────────▼────────┐  │
│  │              Session State                │  │
│  │  sessions/<id>/turns/, runtime/, etc.     │  │
│  └───────────────────────────────────────────┘  │
│                                                 │
│  ┌──────────────┐        ┌──────────────┐       │
│  │ Claude       │        │ Codex        │       │
│  │ Adapter      │        │ Adapter      │       │
│  │ (stdin pipe) │        │ (stdin pipe) │       │
│  └──────────────┘        └──────────────┘       │
│                                                 │
│  ┌──────────────────────────────────────────┐   │
│  │  HTTP Server (127.0.0.1, dynamic port)   │   │
│  │  GET /api/turns, POST /api/interject     │   │
│  │  Serves static watcher UI                │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Session Directory Layout

(see origin: Claude response doc, Section 2)

Sessions are created under `<target-repo>/.acb/sessions/`:

```
.acb/sessions/<session-id>/
├── session.md              # Topic, mode, config (immutable — written once at session start)
├── state.json              # Runtime state: { session_status, current_turn, next_agent, port } (mutable)
├── turns/
│   ├── turn-0001-claude.md # Canonical turn files (immutable)
│   ├── turn-0002-codex.md
│   ├── turn-0003-human.md
│   └── ...
├── artifacts/
│   ├── decisions.md        # Extracted from all turns at session end
│   └── final-summary.md   # Post-session synthesis
└── runtime/                # Ephemeral (safe to delete after session)
    ├── claude/
    │   ├── prompt.md       # Assembled prompt for Claude (rewritten each turn)
    │   └── output.md       # Temp agent output before validation
    └── codex/
        ├── prompt.md       # Assembled prompt piped to Codex via stdin (rewritten each turn)
        └── output.md       # Temp agent output before validation
```

### Canonical Turn Schema

(see origin: Claude response doc, Section 1)

```yaml
---
id: turn-0004-codex          # Required. Format: turn-NNNN-<from>
turn: 4                      # Required. Sequential integer
from: codex                  # Required. codex | claude | human | system
timestamp: 2026-03-23T14:30Z # Required. ISO-8601
status: complete              # Required. complete | needs_human | done | error
decisions:                    # Required. Array of strings, [] when empty
  - "Use polling over fs.watch"
error_detail: null            # Optional. Only on status: error
---

[Turn content in markdown]
```

### Agent Invocation

**Claude Code:**
```bash
# Write assembled prompt to a file, then pipe via stdin
cat > .acb/sessions/<id>/runtime/claude/prompt.md << 'EOF'
[role prompt + session brief + all prior turns + response format instructions]
EOF

claude --print < .acb/sessions/<id>/runtime/claude/prompt.md
```
- **One invocation pattern:** stdin redirection only. Symmetric with Codex. No `-m` or `-p` variants.
- Avoids shell arg-length limits
- stdout captured as the agent's response
- cwd = target repo

**Codex:**
```bash
# 1. Write assembled context (role prompt + session brief + all prior turns)
# to a prompt file in the session runtime dir
cat > .acb/sessions/<id>/runtime/codex/prompt.md << 'EOF'
[role prompt + session brief + all prior turns + response format instructions]
EOF

# 2. Invoke from the TARGET REPO root, piping the prompt via stdin
codex exec \
  --full-auto \
  --no-project-doc \
  -o .acb/sessions/<id>/runtime/codex/output.md \
  < .acb/sessions/<id>/runtime/codex/prompt.md

# 3. Orchestrator reads output.md, validates, persists canonical turn
```

> **Why stdin redirection (`< prompt.md`)?** Codex supports input redirection as the safest way to pass markdown prompts (see `docs/codex-cli-prompting.md`). This bypasses OS arg-length limits, avoids shell interpolation of special characters, and lets us send arbitrarily large context as the prompt itself.
>
> **Why `--no-project-doc`?** Prevents Codex from loading the repo's own `AGENTS.md`, which contains project-level instructions unrelated to the collaboration session. The session role prompt is part of the piped prompt file.
>
> **Why cwd = target repo?** So Codex can read and navigate the codebase being discussed.

### Context Assembly (Per Turn)

(see origin: requirements doc R3, Phase 1 Defaults)

Each agent invocation receives:
1. **Role prompt** — planning mode system prompt (Claude or Codex variant)
2. **Session brief** — contents of `session.md` (topic, mode, constraints)
3. **All prior turns** — all canonical turn files, full content, sorted by turn number

At 20 max turns (~30KB), the full transcript fits in both agents' context windows. No summary compression is needed for v1. If `max_turns` is later raised beyond ~30, introduce running summary + bounded window.

**Truncation rule:** If the assembled prompt exceeds 100K characters, drop whole turns from the oldest end (never split a turn body) until it fits. Insert a truncation notice at the start of the Prior Turns section: `"[Turns 1-N omitted for context length. See earlier turns in the session directory.]"` Log a warning to the CLI.

The prompt is structured as:
```
[Role prompt]

## Session Brief
[session.md content]

## Prior Turns
[all turn files, each with frontmatter + body]

## Your Turn
Respond with YAML frontmatter followed by your markdown response. Required frontmatter fields: id, turn, from, timestamp, status, decisions.
```

### Watcher UI

(see origin: Claude response doc, Section 3)

**Backend (HTTP server bound to `127.0.0.1`, dynamic port):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Serve `ui/index.html` |
| `/api/turns` | GET | Return all turns as JSON `{ turns: [...], session_status, topic, turn_count }`. No pagination for v1. Session status is included here to avoid split-brain — there is no separate `/api/status` endpoint. |
| `/api/interject` | POST | Accept `{ content }`. Max content: 10K chars. Returns `{ ok: true }`. When paused: bypasses queue, directly resumes. When running: pushes to queue array. |
| `/api/end-session` | POST | Sets `endRequested` flag. Loop exits at next turn boundary. Returns `{ ok: true }`. |

**Frontend (single HTML file):**
- Uses recursive `setTimeout` (NOT `setInterval`) — 3s interval, one request in flight at a time
- Derives session status from the latest turn's `status` field (no separate status poll)
- Pauses polling when tab is hidden (`document.visibilitychange`), fires one immediate poll on return
- Renders chat transcript with `[CLAUDE]`, `[CODEX]`, `[DAVIS]`, `[SYSTEM]` labels
- Send button disabled on click, re-enabled on response (prevents double-submit)
- Optimistic interjection rendering (greyed out until confirmed by next poll)
- Yellow banner when latest turn has `status: needs_human`
- "End Session" button in header
- Preformatted text blocks (no markdown rendering in v1)

### Protocol Clarifications

Resolutions for edge cases surfaced by SpecFlow analysis.

**Session completion (`status: done`):**
- When an agent sets `status: done`, the orchestrator gives the *other* agent one final turn to confirm or object.
- If the other agent also sets `status: done`, the session ends and artifacts are generated.
- If the other agent sets `status: complete` (objects/continues), the session resumes normally. The original `done` turn is historical — no retroactive change.
- Post-completion reopening is **not supported in v1**. `DONE` is a terminal state. If Davis wants to continue the conversation, he starts a new session seeded from the previous session's artifacts or summary.

**Orchestrator control flow (while loop + `isPaused` flag):**

The orchestrator is a sequential `while` loop, not a state machine. There are only two meaningful states: running and paused. The `session_status` field in `state.json` (`active`/`paused`/`completed`) is the canonical representation.

```
while (turnCount < maxTurns && !endRequested) {
  invoke agent (with 120s timeout)
  validate output (retry once if invalid)
  write canonical turn (atomic: temp → rename)
  update state.json

  if status == needs_human:
    set isPaused, update state.json → 'paused'
    await humanResponsePromise  ← resolved by POST /api/interject
    write human turn, update state.json → 'active'
    continue with same agent (R11)

  if status == done:
    invoke OTHER agent for final confirmation turn
    if also done: break
    else: continue loop

  drain interjection queue (one item, then re-check)
}

generate artifacts (decisions.md + best-effort final-summary.md)
update state.json → 'completed'
remove lockfile
```

Key rules:
- **Unsolicited interjections** are pushed to a plain array by the HTTP server. The loop drains one per turn boundary.
- **Paused-state responses** bypass the array. `POST /api/interject` directly resolves the orchestrator's `humanResponsePromise`, persists the human turn, and the loop resumes. This avoids deadlock.
- **`DONE` is terminal.** No reopening in v1. Start a new session to continue.

**`decisions` field:** Required, always an array. `[]` when empty. This reconciles the conflict between the requirements doc (required) and Claude response doc (optional). Using required because it simplifies validation — no null-checking.

**Human turn schema:**
```yaml
---
id: turn-0005-human
turn: 5
from: human
timestamp: 2026-03-23T15:00:00Z
status: complete        # human turns are always 'complete' unless ending session
decisions: []           # humans can include decisions if they want
---
```
- Human turns can set `status: done` to end the session (triggers the same completion flow — other agent gets one final turn).
- Human turns cannot set `status: needs_human` or `status: error`.
- The orchestrator generates the frontmatter; the human only provides the content body.

**`session.md` schema:**
**`session.md` (immutable):**
```yaml
---
id: <session-uuid>
topic: "Plan Phantom wallet deep-link support"
mode: planning
max_turns: 20
first_agent: claude
target_repo: /absolute/path/to/repo
created: 2026-03-23T14:00:00Z
---

[Optional additional context or instructions from the human]
```

**`state.json` (mutable — updated at each turn boundary via atomic write):**
```json
{
  "session_status": "active",
  "current_turn": 4,
  "next_agent": "codex",
  "port": 3341
}
```
`session_status` values: `active`, `paused`, `completed`.
Recovery reads `state.json` to determine whether a session is resumable. `session.md` is never mutated after creation.

**`POST /api/interject` response format:**
```json
// Success (200):
{ "ok": true }

// Error (400):
{ "error": "Content is required" }
// or content too long:
{ "error": "Content exceeds 10000 character limit" }
```
No queue position, no queued/injected distinction. The UI uses optimistic rendering — the interjection appears immediately (greyed out) and is replaced by the canonical turn on the next poll.

**Interjection queue:** A plain array on the orchestrator. No max size, no HTTP 429. If the user floods the queue, all items are processed one per turn boundary. The context size guard (100K) prevents prompt overflow regardless of queue size.

**Graceful shutdown:**
End-session sets a flag on the orchestrator. The loop checks the flag at each turn boundary and exits cleanly. Ctrl+C is trapped via SIGINT handler: the handler updates `state.json` to `completed`, removes the lockfile, and exits. If the trap fails (e.g., double Ctrl+C), the process dies hard and crash recovery (Phase 3) handles the orphaned session.

**Prompt governance asymmetry (known limitation):**
Claude Code loads the target repo's `CLAUDE.md` if one exists. Codex is isolated via `--no-project-doc`. This means the two agents do not operate under identical prompt governance. The session role prompt is explicit about output format (YAML frontmatter) and takes priority over repo-level instructions. If a repo's `CLAUDE.md` contains instructions that conflict with the session role prompt (e.g., "never output YAML"), the orchestrator's validation will catch malformed output and retry. If contamination proves persistent, a future version can invoke Claude from an isolated cwd or investigate suppression flags.

### Failure Handling

(see origin: Claude response doc, Section 5; requirements doc R13)

| Scenario | Action |
|---|---|
| Output file missing | Retry once → error turn → pause for human |
| Invalid frontmatter | Retry once → error turn (raw content preserved) → pause |
| Empty output | Treat as missing → retry once → error turn → pause |
| CLI nonzero exit | Retry once → error turn with exit details → pause |
| Turn timeout (120s) | Kill process → retry once → error turn → pause |
| Malformed interjection | HTTP 400, no turn persisted |
| Orchestrator crash | On restart, check `session_status` in `state.json` — only resume sessions where `session_status: active` or `session_status: paused`. See Phase 3 for full recovery semantics. |

Retry policy: 1 automatic retry per turn, immediate (no backoff). Error turns are canonical and visible in the UI.

**Session-level status updates:** The orchestrator updates `session_status` in `state.json` (atomic write) at each turn boundary:
- Session start: `active`
- `needs_human` pause: `paused`
- Human resumes: `active`
- Session ends (artifacts generated): `completed`

`session.md` is never mutated after creation. `state.json` is the mutable runtime state file.

## Implementation Phases

### Phase 1: Core Loop + Resilience Basics

**Goal:** Two agents talk back and forth, producing canonical turn files on disk. Agent hangs are caught by timeouts. Session end generates artifacts.

**Files to create:**

```
package.json
bin/
└── acb                 # CLI entry point, resolves src/index.js from install location
src/
├── index.js            # Main entry: arg parsing, session init, starts orchestrator
├── orchestrator.js     # Turn loop: invoke agent → validate → persist → check status → next
├── session.js          # Create .acb/sessions/<id>/ dir structure, write session.md, add .acb/ to .gitignore
├── agents/
│   ├── claude.js       # Spawn claude --print, capture stdout, timeout enforcement
│   └── codex.js        # Write prompt.md, spawn codex exec --no-project-doc via stdin, timeout enforcement
├── validation.js       # Parse YAML frontmatter, validate required fields
├── context.js          # Assemble prompt from session brief + all turns (with 100K size guard)
└── artifacts.js        # Generate decisions.md and final-summary.md at session end
```

`package.json`:
```json
{
  "name": "agent-collab",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "acb": "./bin/acb"
  },
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "gray-matter": "^4.0.3"
  }
}
```

**Key implementation details:**

- `gray-matter` for YAML frontmatter parsing/serialization (explicitly configure with `js-yaml` `DEFAULT_SCHEMA`)
- Session IDs use `crypto.randomUUID()` (built-in since Node 19, stable in 20+)
- No framework — plain Node.js with `child_process.spawn` (never `shell: true`)
- CLI args parsed in `index.js` with hardcoded defaults: `--topic` (required), `--mode` (default: planning), `--max-turns` (default: 20), `--first` (default: claude)

**`src/index.js`** — Entry point:
```javascript
// Parse CLI args: --topic (required), --mode, --max-turns, --first (claude|codex)
// Hardcoded defaults — no config file needed for v1
// Call session.create() to initialize directory structure
// Call orchestrator.run(session) to start the turn loop
// On completion, call artifacts.generate(session)
// Log session path and exit
```

**`src/orchestrator.js`** — Turn loop:
```javascript
// isPaused = false
// while (turnCount < maxTurns) {
//   1. Determine next agent (alternating, or same agent after needs_human resume)
//   2. Call context.assemble(session) to build prompt
//   3. Call agents/<agent>.invoke(prompt, session) — includes timeout (120s default)
//   4. If timeout or error: retry once (same prompt), then write error turn + pause
//   5. Call validation.validate(output) — if invalid: retry once, then error turn + pause
//   6. Orchestrator assigns canonical turn number, id, filename (ignores agent values)
//   7. Write canonical turn file to turns/ (atomic: write temp → rename)
//   8. Update state.json (session_status, current_turn, next_agent) via atomic write
//   9. Check status:
//      - 'needs_human': set isPaused, await humanResponsePromise
//      - 'done': give OTHER agent one final turn to confirm/object
//        - If other also says 'done': break
//        - If other says 'complete': continue loop
//      - 'complete': continue
//   10. Drain interjection queue if any (one per boundary, re-check)
// }
```

**`src/agents/claude.js`**:
```javascript
// Write assembled prompt to runtime/claude/prompt.md
// Open prompt.md as a readable stream
// spawn('claude', ['--print'], { cwd: targetRepo, stdio: [promptStream, 'pipe', 'pipe'] })
// NEVER use shell: true — security invariant
// Timeout: setTimeout + process.kill() after 120s
// Capture stdout as response, stderr for error reporting
// Write stdout to runtime/claude/output.md
// Return { exitCode, output, timedOut, stderr }
```

**`src/agents/codex.js`**:
```javascript
// Write assembled prompt to runtime/codex/prompt.md
// spawn('codex', ['exec', '--full-auto', '--no-project-doc', '-o', outputPath], {
//   cwd: targetRepo,
//   stdin: promptFileStream   // pipe full context via stdin redirection
// })
// NEVER use shell: true — security invariant
// Timeout: setTimeout + process.kill() after 120s (configurable)
// Capture stderr for error reporting
// Read output file
// Return { exitCode, output, timedOut, stderr }
```

**`src/validation.js`**:
```javascript
// Parse frontmatter with gray-matter (explicit DEFAULT_SCHEMA)
// Enforce max output size (500KB) before parsing
// Check required fields: id, turn, from, timestamp, status, decisions
// Validate status enum: complete | needs_human | done | error
// Validate from matches expected agent (strict regex: /^(claude|codex|human|system)$/)
// Validate decisions is array
// Log but IGNORE agent-provided turn/id values (orchestrator is authority)
// Return { valid, errors, data, content }
```

**`src/context.js`**:
```javascript
// Read session.md for topic and mode
// Read all existing turn files from turns/ (sorted by turn number)
// Concatenate: role prompt + session brief + all turns + response format instructions
// Size guard: if total > 100K chars, truncate from oldest turns, log warning
// Return assembled prompt string
```

**`src/artifacts.js`**:
```javascript
// decisions.md (always succeeds — pure file I/O, no CLI call):
//   Read all turn files, extract `decisions` arrays, write as ordered list
//   with turn number and agent attribution
//
// final-summary.md (best-effort — CLI call may fail):
//   Invoke Claude CLI with full transcript as prompt (120s timeout):
//   "Synthesize this planning session into a structured summary..."
//   If successful: write to artifacts/final-summary.md
//   If timeout/error: write artifacts/final-summary-failed.md with error details
//   and log warning: "Summary generation failed. Transcript is available in turns/."
//   Artifact failure does NOT block session completion — decisions.md + turns are always available.
```

- [ ] `package.json` with `bin` field and `gray-matter` dependency
- [ ] `bin/acb` — CLI entry point that resolves `src/index.js` from install location
- [ ] `src/index.js` — parse CLI args with hardcoded defaults, acquire lockfile, init session, run loop, generate artifacts, release lockfile
- [ ] `src/session.js` — acquire `.acb/lock` (error if PID alive), create `.acb/sessions/<id>/`, write `session.md` + `state.json`, add `.acb/` to `.gitignore`
- [ ] `src/agents/claude.js` — write prompt file, pipe to `claude --print` via stdin, cwd = target repo, 120s timeout
- [ ] `src/agents/codex.js` — write prompt file, pipe to `codex exec --full-auto --no-project-doc -o` via stdin, cwd = target repo, 120s timeout
- [ ] `src/validation.js` — YAML frontmatter parsing (safe schema) + schema validation + 500KB size guard
- [ ] `src/context.js` — context assembly (all turns + 100K size guard)
- [ ] `src/orchestrator.js` — turn loop with `isPaused` flag, retry logic (1 retry), error turn generation
- [ ] `src/artifacts.js` — extract decisions, generate final-summary via Claude CLI
- [ ] Manual test: `cd` into a test repo, run `acb --topic "Test conversation" --first claude`, verify `.acb/sessions/` appears with turn files

**Acceptance criteria:**
- [ ] Running `acb --topic "Plan a REST API" --first claude` from any repo creates `.acb/sessions/<id>/` with properly structured turn files
- [ ] Turn files have valid YAML frontmatter with all required fields
- [ ] Orchestrator assigns turn numbers/IDs/filenames (not agents)
- [ ] Agents alternate turns correctly (claude → codex → claude → ...)
- [ ] Both agents can read and reference files in the target repo
- [ ] Session stops at configured max turn limit or when both agents say `done`
- [ ] Agent hangs are killed after 120s timeout and retried once
- [ ] Invalid agent output is detected, retried once, then produces a visible error turn
- [ ] `decisions.md` and `final-summary.md` are generated at session end
- [ ] `.acb/` is added to `.gitignore` if not already present

---

### Phase 2: Watcher UI + Human-in-the-Loop

**Goal:** Davis can watch the conversation in a browser, interject at turn boundaries, respond to escalations, and end sessions.

**Files to create/modify:**

```
src/
├── server.js           # HTTP server + API endpoints (bound to 127.0.0.1)
├── orchestrator.js     # Add interjection queue (plain array), needs_human pause/resume
└── ui/
    └── index.html      # Static watcher page with polling + interjection input
```

**`src/server.js`**:
```javascript
// http.createServer bound to 127.0.0.1:0 (OS-assigned port)
// Validate Origin header on every request (reject non-localhost)
//
// GET /              → serve ui/index.html
// GET /api/turns     → return { turns: [...], session_status, topic, turn_count }
//                      session_status included to avoid split-brain — no separate status endpoint
// POST /api/interject → accept { content }, validate content length (max 10K chars)
//                       If PAUSED: bypass queue, directly resolve orchestrator's wait promise
//                       If RUNNING: push to interjection array, return { "ok": true }
// POST /api/end-session → set endRequested flag, loop exits on next iteration
```

**`src/ui/index.html`**:
```html
<!-- Single-file app, no dependencies -->
<!-- Uses recursive setTimeout (NOT setInterval) for polling — 3s interval -->
<!-- Only one request in flight at a time (fetchInFlight guard) -->
<!-- Discard responses with lower turn count than last processed -->
<!-- Derive paused/active status from latest turn's status field (no split-brain) -->
<!-- Listen for document.visibilitychange — pause polling when tab hidden -->
<!-- Renders: chat transcript with [CLAUDE], [CODEX], [DAVIS], [SYSTEM] labels -->
<!-- Text input + send button — disable on click, re-enable on response -->
<!-- Yellow banner when latest turn has status: needs_human -->
<!-- "End Session" button in header -->
<!-- Optimistic rendering: show interjection immediately (greyed out) until confirmed by next poll -->
```

**Orchestrator changes:**
```javascript
// Interjection queue: a plain array on the orchestrator (no separate module)
// At each turn boundary: if queue.length > 0, shift one item, write as human turn
// needs_human pause: create a Promise, expose its resolver to the server
//   Server calls resolver directly when POST /api/interject arrives in PAUSED state
//   This bypasses the queue — avoids deadlock
// After human responds: resume with same agent (R11) (no human override in v1)
// end-session: check endRequested flag at turn boundary, break loop if set
```

- [ ] `src/server.js` — HTTP server bound to `127.0.0.1:0` (dynamic port) with Origin validation
- [ ] `src/server.js` — `GET /api/turns` returns turns + `session_status` in single response
- [ ] `src/server.js` — `POST /api/interject` with 10K content limit, direct resume when PAUSED
- [ ] `src/server.js` — `POST /api/end-session` sets flag for clean exit
- [ ] `src/orchestrator.js` — interjection queue (plain array, drained at turn boundaries)
- [ ] `src/orchestrator.js` — `needs_human` pause/resume via Promise + resolver (direct resume path, no deadlock)
- [ ] `src/orchestrator.js` — update `state.json` at transitions (session_status, current_turn, next_agent)
- [ ] `src/orchestrator.js` — deterministic turn resumption (R11)
- [ ] `src/orchestrator.js` — `status: done` protocol (other agent gets one final turn)
- [ ] `src/orchestrator.js` — end-session flag checked at turn boundary
- [ ] `src/ui/index.html` — recursive setTimeout polling, fetchInFlight guard, visibilitychange handler
- [ ] `src/ui/index.html` — chat transcript with agent labels, turn numbers, timestamps
- [ ] `src/ui/index.html` — interjection input with disable-on-click + optimistic rendering
- [ ] `src/ui/index.html` — escalation banner derived from latest turn status
- [ ] `src/ui/index.html` — "End Session" button
- [ ] Manual test: run session, open the URL printed by the CLI, watch turns appear
- [ ] Manual test: type interjection while agent is running, verify it queues and appears at turn boundary
- [ ] Manual test: trigger `needs_human`, verify pause + banner + direct resume
- [ ] Manual test: click "End Session", verify clean shutdown + artifacts

**Acceptance criteria:**
- [ ] Browser at the dynamically assigned localhost URL shows a live-updating transcript
- [ ] New turns appear within 3 seconds of being written to disk
- [ ] Davis can type a message and it appears as a `[DAVIS]` turn at the next turn boundary
- [ ] `status: needs_human` pauses the loop, shows a banner, and direct-injects the human response (no deadlock)
- [ ] After escalation, the same agent that escalated resumes (R11)
- [ ] "End Session" cleanly stops the loop and generates artifacts
- [ ] Server only accepts requests from localhost (Origin check + 127.0.0.1 binding)
- [ ] No poll response flickering (recursive setTimeout, fetchInFlight guard)

---

### Phase 3: Crash Recovery

**Goal:** The orchestrator can resume interrupted sessions after a crash.

**Files to create/modify:**

```
src/
├── recovery.js         # Scan sessions for crash recovery, determine resume point
└── index.js            # Call recovery check on startup
```

**`src/recovery.js`**:
```javascript
// On startup (before creating a new session), check for recoverable sessions:
// 1. Scan .acb/sessions/ for dirs where state.json has session_status: 'active' or 'paused'
//    (NOT 'completed' — that means the session finished normally)
//    NOTE: Do NOT use per-turn status: 'complete' to judge session completion.
// 2. Also check: is the lockfile's PID still alive? If yes, another process owns it — skip.
// 3. For each recoverable session:
//    a. Find the last canonical turn in turns/ (by turn number)
//    b. Read state.json for next_agent and current_turn
//    c. Discard any incomplete runtime/ output
//
// Recovery behavior (non-interactive):
// - If exactly 1 recoverable session: auto-resume it (print: "Resuming session <id> from turn <N>")
// - If multiple recoverable sessions: print the list and exit with:
//     "Multiple interrupted sessions found. Use --resume <session-id> to resume one."
// - If --resume <session-id> flag is provided: resume that specific session
// - If no recoverable sessions: proceed to create a new session normally
```

- [ ] `src/recovery.js` — scan `.acb/sessions/` for `state.json` with `session_status: active|paused`, determine resume point
- [ ] `src/index.js` — call recovery check on startup; auto-resume single session, list multiple, accept `--resume <id>`
- [ ] SIGINT handler: trap Ctrl+C, update `state.json` to `completed`, remove lockfile, exit
- [ ] Manual test: kill orchestrator mid-session, restart `acb`, verify auto-resume from last canonical turn
- [ ] Manual test: verify completed sessions are not flagged for recovery
- [ ] Manual test: create two interrupted sessions, verify `acb` prints list and exits

**Acceptance criteria:**
- [ ] Restarting `acb` after a crash auto-resumes if exactly one interrupted session exists
- [ ] Multiple interrupted sessions prints a list and requires `--resume <id>`
- [ ] Recovery resumes from the correct turn (last canonical + 1)
- [ ] Incomplete `runtime/` output from before a crash is discarded
- [ ] Completed sessions (`session_status: completed` in `state.json`) are not flagged
- [ ] Ctrl+C updates `state.json` and removes the lockfile

---

## System-Wide Impact

### Interaction Graph

Session start → orchestrator loop → agent adapter → CLI subprocess → file I/O → validation → canonical turn write → context rebuild → next agent. In parallel: HTTP server → polls turns dir → serves to UI. Human interjection → HTTP POST → queue → drain at turn boundary → human turn write.

### Error Propagation

Errors flow upward: CLI process fails → adapter captures exit code/stderr → orchestrator retries → if retry fails, orchestrator writes error turn → HTTP server exposes error turn → UI renders it. No silent failure paths — every error becomes a visible canonical turn.

### State Lifecycle Risks

- **Partial turn write:** If the orchestrator crashes mid-write of a canonical turn file, the file may be corrupted. Mitigation: write to a temp file first, then `rename` (atomic on most filesystems).
- **Orphaned runtime files:** If the orchestrator crashes, `runtime/` may have stale output. Mitigation: always discard runtime content on startup before resuming.

### API Surface Parity

Only one interface exists: the CLI entry point + HTTP server. No SDKs, no programmatic API. The HTTP endpoints are internal to the watcher UI.

### Integration Test Scenarios

1. **Full 10-turn session:** Start session → 10 agent turns alternate correctly → session ends at turn limit → artifacts generated → UI shows complete transcript
2. **Human interjection mid-session:** Agent turn completes → human interjects via UI → interjection appears as turn → next agent responds to it
3. **Escalation round-trip:** Agent sets `needs_human` → orchestrator pauses → UI shows banner → human responds → same agent resumes
4. **Agent failure + retry:** Mock Codex timeout → orchestrator retries → retry succeeds → session continues normally
5. **Crash recovery:** Start session → kill orchestrator at turn 5 → restart → orchestrator resumes at turn 6

## Acceptance Criteria

### Functional Requirements

- [ ] (R1) Orchestrator alternates agent invocations and enforces turn limits
- [ ] (R2) All turns have valid YAML frontmatter with required schema fields
- [ ] (R3) Agent context includes all prior turns with a 100K char size guard
- [ ] (R4) Human interjections via UI are queued and injected at turn boundaries
- [ ] (R5) `status: needs_human` pauses the loop until human responds
- [ ] (R6) Watcher UI at dynamically assigned localhost port shows live transcript with 3-second polling
- [ ] (R7) Session end generates `decisions.md` and `final-summary.md`
- [ ] (R8) Claude and Codex have distinct, prescriptive role prompts per mode
- [ ] (R9) Both CLIs are invoked in non-interactive mode (no API billing)
- [ ] (R10) Orchestrator validates and owns all canonical turn filenames
- [ ] (R11) After escalation, same agent resumes (no human override in v1)
- [ ] (R12) Each session runs in an isolated directory
- [ ] (R13) Errors and timeouts produce visible canonical error turns

### Non-Functional Requirements

- [ ] Turn files are immutable once written (no in-place modification)
- [ ] Session directories are self-contained (portable, no external state)
- [ ] Works on Windows 11 with Node.js 20+ (required for `crypto.randomUUID()`)
- [ ] No external dependencies beyond `gray-matter`
- [ ] No build step — plain ES module JavaScript

## Dependencies & Prerequisites

- Node.js 20+ installed (required for stable `crypto.randomUUID()`)
- Claude Code CLI (`claude`) installed and authenticated
- Codex CLI (`codex`) installed and authenticated (ChatGPT Pro subscription)
- Both CLIs available on PATH

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Codex CLI `--full-auto` behavior changes | Medium | High | Pin CLI version; test with each update |
| Agent output doesn't include valid frontmatter | High | Medium | Clear instructions in prompt; validation + retry |
| OS arg-length limits for prompts | Medium | Medium | File-based prompt delivery via stdin for both agents; 100K size guard on context assembly |
| Claude loads target repo's CLAUDE.md | Medium | Low | Accepted for v1 — project context is usually helpful. Role prompt overrides output format. Codex is isolated via `--no-project-doc`. Asymmetric prompt governance is a known limitation. Revisit if contamination causes formatting failures. |
| Agent responses are repetitive/low quality | Medium | Medium | Prescriptive role prompts with explicit challenge targets |
| `fs.rename` not atomic on Windows NTFS | Low | Medium | Use write-to-temp + rename pattern; verify behavior |

## Research Insights

**Deepened on:** 2026-03-23
**Agents used:** Architecture Strategist, Security Sentinel, Performance Oracle, Code Simplicity Reviewer, Frontend Races Reviewer, Best Practices Researcher

### Key Improvements (Priority Order)

1. **Move timeouts to Phase 1.** Agent CLI hangs are the most likely failure during development. A `setTimeout` + `process.kill()` is ~10 lines and prevents blocked development. *(Architecture, YAGNI)* — **Applied: timeouts are now in Phase 1.**

2. **Drop running summary for v1.** At max 20 turns (~30KB transcript), the full history fits in both agents' context windows. *(YAGNI, Performance)* — **Applied: summary.js removed, all turns sent as context.**

3. **Merge 5 phases into 3.** *(YAGNI, Architecture)* — **Applied: phases consolidated in Implementation Phases section.**

4. **Simplify the state machine.** The 7-state diagram models a sequential while loop. For v1, a loop with an `isPaused` flag is sufficient. The `session_status` field (`active`/`paused`/`completed`) already captures the states that matter for recovery and UI. *(YAGNI, Architecture — note: architecture strategist recommends keeping the state machine but extracting it to a module; YAGNI recommends a simpler loop. The loop is recommended for v1 given the single-user, 20-turn scope.)*

5. **Orchestrator owns `turn`, `id`, and filenames — agents don't control them.** Agents produce content; the orchestrator assigns turn numbers, generates IDs, and writes canonical filenames. Agent-provided `turn`/`id` values are logged but ignored. This prevents state corruption and path traversal. *(Security, Architecture)*

### Security Hardening

**Must-build for v1:**

| Concern | Mitigation |
|---|---|
| **HTTP server bind address** | Bind to `127.0.0.1` only (already specified in API contract) |
| **CORS / Origin checking** | Validate `Origin` header on every request; reject non-localhost origins |
| **Never `shell: true`** | `child_process.spawn` with argument arrays only. Security invariant. |
| **Path traversal** | Validate `from` field with strict regex `/^(claude\|codex\|human\|system)$/`. Orchestrator owns all filenames. |
| **YAML safety** | Configure `gray-matter` with `js-yaml` `DEFAULT_SCHEMA`. Max output size 500KB. |
| **Interjection content limit** | 10K character max on `POST /api/interject` |

**Nice-to-have (add if time permits):**

| Concern | Mitigation |
|---|---|
| **CSRF protection** | Random token at startup, embed in HTML, require on POSTs |
| **`---` escaping** | Escape YAML frontmatter delimiters in interjection content |
| **`--topic` sanitization** | Reject shell metacharacters in topic strings |

**Platform-dependent (Windows):**

| Concern | Mitigation |
|---|---|
| **File permissions** | On Unix, set `0600` on `.acb/` files. On Windows, rely on user-profile ACLs (no `chmod` equivalent via Node). |
| **Atomic rename** | `fs.rename` is atomic on NTFS for same-volume renames when target doesn't exist (true for immutable turn files). Verify in a startup self-test if needed. |

### Performance Insights

- **CLI invocations dominate all costs** by 2 orders of magnitude (10-120s per turn vs. <15ms for all file I/O). Only optimizations that reduce CLI calls matter.
- **If summaries are kept:** Run summary generation concurrently with the next turn, not sequentially. The summary doesn't need to be ready until the *next* agent's prompt is assembled. This eliminates 100-300s of blocking time per 20-turn session.
- **In-memory turn cache:** Maintain a `Map<turnId, parsedTurn>` in the HTTP server, populated when turns are written. `GET /api/turns` becomes an array slice — zero file I/O on poll. ~15 lines of code.
- **Apply atomic writes (temp + rename) to `session.md`** in addition to turn files.

### Frontend Reliability (Required for Phase 2)

| Issue | Fix |
|---|---|
| **Out-of-order poll responses** | Use recursive `setTimeout` (not `setInterval`). Only one request in flight at a time. Discard responses with a lower turn count than the last processed. |
| **Status/turns split-brain** | Merge `/api/status` into the `/api/turns` response, or derive UI status entirely from the latest turn's `status` field. Don't poll them separately. |
| **Double-click sends duplicates** | Disable send button on click, re-enable on response. Server-side: reject consecutive identical interjections. |
| **Background tab throttling** | Listen for `document.visibilitychange`. Pause polling when hidden, fire one immediate poll on return. Prevents `setInterval` burst on tab refocus. |
| **Optimistic interjection rendering** | When POST succeeds, render the interjection immediately in the transcript (greyed out). Replace with the canonical turn when it appears in the next poll. |

### Simplifications Applied

| Item | Change |
|---|---|
| `src/summary.js` | Removed for v1. Send all turns as context (or last N with size guard). |
| `src/interjection.js` | Replaced with a plain array on the orchestrator. No max size, no HTTP 429, no position feedback. |
| `src/config.js` | Removed. Inline 4 CLI arg defaults in `index.js`. |
| `attachments/` directory | Removed. Agents can reference repo files by path via cwd. |
| `response_to` field | Removed from schema. Agents can reference prior turns in the body. |
| `?after=<turn-id>` parameter | Deferred. Return all turns on every poll for v1 (20 turns is ~100KB). |
| Graceful shutdown protocol | Simplified. End-session sets a flag; loop exits on next iteration. Ctrl+C kills the process; crash recovery handles the rest. |
| Interjection response format | Simplified to `{ "ok": true }`. |
| Phases | 5 → 3 (see Key Improvements #3) |

### Architecture Notes

- **Orchestrator-server coupling:** Define an explicit interface for pause/resume. Recommended: a shared session controller with `waitForHuman()` (returns Promise) and `resumeFromHuman(content)` (resolves it). Keeps coupling narrow and testable.
- **`session.md` is immutable; `state.json` is mutable.** Runtime state (session_status, current_turn, next_agent, port) lives in `state.json`. Session config (topic, mode, max_turns) lives in `session.md`. This split is resolved — no mutation contract ambiguity.
- **Concurrent sessions:** Resolved — one session per repo enforced via `.acb/lock`. Dynamic port avoids port conflicts. See "Concurrency & Port Rules" section.
- **Claude CLI invocation:** Resolved — stdin redirection only (`claude --print < prompt.md`). No `-m` or `-p` variants. Symmetric with Codex.
- **Phase 1 context size guard:** Cap assembled prompt at 100K chars. Truncate from oldest turns and log a warning. Or set `max_turns` default to 6 for initial testing.

## Deferred to Future Versions

(see origin: requirements doc, Deferred to Planning)

- `code_review` and `debate` session modes
- Running summary generation (`summary.md`) — not needed at 20-turn max; add when max_turns exceeds ~30
- Attachment handling (copying reference files into session, including them in context)
- Additional frontmatter fields (`model`, `duration_ms`, token metadata)
- Direct API synthesis path for artifacts
- Rich UI: markdown rendering, artifact viewer, session history browser
- Optimized context window strategies (summary + bounded window for large sessions)
- `?after=<turn-id>` incremental fetch on `GET /api/turns` (not needed at 20 turns)
- `response_to` field in turn schema (agents can reference prior turns in body text)
- WebSocket push in the UI (upgrade from polling)

## Sources & References

### Origin

- **Requirements doc:** [.claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md](.claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md) — Carries forward: document handoff architecture, CLI subprocess invocation, per-session isolation, orchestrator-owned canonicals, bounded context policy, polling watcher UI
- **Claude response (locked decisions):** [.claude/workflows/brainstorms/2026-03-23-agent-collab-claude-response.md](.claude/workflows/brainstorms/2026-03-23-agent-collab-claude-response.md) — Carries forward: canonical schema, session layout, UI architecture, role prompts, failure handling rules
- **Codex handoff:** [.claude/workflows/brainstorms/2026-03-23-agent-collab-handoff-to-claude.md](.claude/workflows/brainstorms/2026-03-23-agent-collab-handoff-to-claude.md) — Carries forward: orchestrator validation pattern, per-agent runtime dirs, stdin prompt delivery model

### External References

- [Codex CLI non-interactive mode](https://developers.openai.com/codex/noninteractive) — `codex exec` documentation
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference) — full flag reference
- [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md) — custom instructions mechanism (suppressed via `--no-project-doc`)
- [gray-matter](https://github.com/jonschlinkert/gray-matter) — YAML frontmatter parsing
