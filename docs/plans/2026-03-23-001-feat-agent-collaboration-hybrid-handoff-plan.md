---
title: "feat: Agent Collaboration Hybrid Document Handoff"
type: feat
status: active
date: 2026-03-23
origin: .claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md
---

# Agent Collaboration: Hybrid Document Handoff

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
5. Assembles context (session brief + all prior turns) for each invocation
6. Serves a static HTML watcher UI via a tiny HTTP server with 3-second polling
7. Accepts human interjections via HTTP POST, queuing them for the next turn boundary
8. Handles escalation (`status: needs_human`), errors, timeouts, and retries
9. Generates a best-effort decisions log at session end

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
│           ├── session.json
│           ├── turns/
│           ├── artifacts/
│           └── runtime/
├── src/
└── .gitignore                   # includes .acb/
```

### Concurrency & Port Rules

- **One session per repo at a time.** On startup, the orchestrator creates a lockfile at `.acb/lock`. If the lockfile already exists, `acb` exits with an error: `"A session may already be running. Delete .acb/lock to proceed."`
- **Dynamic port.** The HTTP server binds to `127.0.0.1:0` (OS-assigned port). The actual port is written to `session.json` and printed to the CLI: `Watcher UI: http://localhost:<port>`. No hardcoded port means no conflicts between sessions in different repos.
- **Multiple repos can run simultaneously** — each has its own `.acb/lock` and its own dynamically assigned port.

### Agent Repo Access

Both agents are invoked with cwd = target repo, so they can read and navigate the codebase. This changes the Codex invocation model:

- **Claude:** `claude --print < prompt.md` (stdin redirection) runs from target repo cwd. **Known limitation:** Claude Code will load the target repo's `CLAUDE.md` if one exists. This is accepted for v1 because project-level instructions provide useful context (conventions, patterns). The session role prompt is explicit about output format (YAML frontmatter) and takes priority. If contamination proves problematic in practice, a future version can invoke Claude from an isolated cwd or investigate suppression flags.
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
│  │  /api/turns, /api/interject, /end-session │   │
│  │  Serves static watcher UI                │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Session Directory Layout

Sessions are created under `<target-repo>/.acb/sessions/`:

```
.acb/sessions/<session-id>/
├── session.json            # All session state: config + runtime (atomic writes)
├── turns/
│   ├── turn-0001-claude.md # Canonical turn files (immutable)
│   ├── turn-0002-codex.md
│   ├── turn-0003-human.md
│   └── ...
├── artifacts/
│   └── decisions.md        # Best-effort extraction from turns at session end
└── runtime/                # Ephemeral (safe to delete after session)
    ├── prompt.md           # Assembled prompt for current agent (rewritten each turn)
    └── output.md           # Temp agent output before validation
```

### Canonical Turn Schema

```yaml
---
id: turn-0004-codex          # Required. Format: turn-NNNN-<from>
turn: 4                      # Required. Sequential integer
from: codex                  # Required. codex | claude | human | system
timestamp: 2026-03-23T14:30Z # Required. ISO-8601
status: complete              # Required. complete | needs_human | done | error
decisions:                    # Optional. Array of strings. Best-effort — agents may omit.
  - "Use polling over fs.watch"
---

[Turn content in markdown. Error details go in the body for error turns.]
```

### Agent Invocation

**Claude Code:**
```bash
# Write assembled prompt to a file, then pipe via stdin
cat > .acb/sessions/<id>/runtime/prompt.md << 'EOF'
[role prompt + session brief + all prior turns + response format instructions]
EOF

claude --print < .acb/sessions/<id>/runtime/prompt.md
```
- **One invocation pattern:** stdin redirection only. Symmetric with Codex. No `-m` or `-p` variants.
- Avoids shell arg-length limits
- stdout captured as the agent's response
- cwd = target repo

**Codex:**
```bash
# 1. Write assembled context (role prompt + session brief + all prior turns)
# to a prompt file in the session runtime dir
cat > .acb/sessions/<id>/runtime/prompt.md << 'EOF'
[role prompt + session brief + all prior turns + response format instructions]
EOF

# 2. Invoke from the TARGET REPO root, piping the prompt via stdin
codex exec \
  --full-auto \
  --no-project-doc \
  --skip-git-repo-check \
  -o .acb/sessions/<id>/runtime/output.md \
  < .acb/sessions/<id>/runtime/prompt.md \
  2>/dev/null

# 3. Orchestrator reads output.md, validates, persists canonical turn
```

> **Why stdin redirection (`< prompt.md`)?** Codex supports input redirection as the safest way to pass markdown prompts (see `docs/codex-cli-prompting.md`). This bypasses OS arg-length limits, avoids shell interpolation of special characters, and lets us send arbitrarily large context as the prompt itself.
>
> **Why `--no-project-doc`?** Prevents Codex from loading the repo's own `AGENTS.md`, which contains project-level instructions unrelated to the collaboration session. The session role prompt is part of the piped prompt file.
>
> **Why `--skip-git-repo-check`?** Codex requires a git repo by default. This flag avoids errors when the working directory or session paths aren't git-initialized.
>
> **Why `2>/dev/null`?** Codex emits thinking tokens to stderr during processing. Redirecting stderr suppresses these to keep output clean. For error detection, the orchestrator checks the exit code and the output file — stderr thinking tokens are not useful for error handling.
>
> **Why cwd = target repo?** So Codex can read and navigate the codebase being discussed.

### Context Assembly (Per Turn)

Each agent invocation receives:
1. **Role prompt** — planning mode system prompt (Claude or Codex variant)
2. **Session brief** — topic and mode from `session.json`
3. **All prior turns** — all canonical turn files, full content, sorted by turn number

At 20 max turns (~30KB), the full transcript fits in both agents' context windows. No truncation is needed for v1. If `max_turns` is later raised beyond ~30, introduce running summary + bounded window.

The prompt is structured as:
```
[Role prompt]

## Session Brief
[session.json topic and mode]

## Prior Turns
[all turn files, each with frontmatter + body]

## Your Turn
Respond with YAML frontmatter followed by your markdown response. Required frontmatter fields: id, turn, from, timestamp, status. Optional: decisions (array of strings).
```

### Watcher UI

**Backend (HTTP server bound to `127.0.0.1`, dynamic port):**

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Serve `ui/index.html` |
| `/api/turns` | GET | Return all turns as JSON `{ turns: [...], session_status, topic, turn_count }`. No pagination for v1. Session status is included here to avoid split-brain — there is no separate `/api/status` endpoint. |
| `/api/interject` | POST | Accept `{ content }`. Max content: 10K chars. Returns `{ ok: true }`. When paused: bypasses queue, directly resumes. When running: pushes to queue array. |
| `/api/end-session` | POST | Sets `endRequested` flag. Loop exits at next turn boundary. Returns `{ ok: true }`. |

**Frontend (single HTML file):**
- Uses recursive `setTimeout` (NOT `setInterval`) — 3s interval, one request in flight at a time
- Uses `session_status` from the `/api/turns` response (no separate status endpoint)
- Renders chat transcript with `[CLAUDE]`, `[CODEX]`, `[DAVIS]`, `[SYSTEM]` labels
- Send button disabled on click, re-enabled on response (prevents double-submit)
- Yellow banner when `session_status` is `paused`
- "End Session" button in header
- Preformatted text blocks (no markdown rendering in v1)

### Protocol Clarifications

Resolutions for edge cases surfaced by SpecFlow analysis.

**Session completion (`status: done`):**
- When any agent (or human) sets `status: done`, the session ends immediately. Artifacts are generated.
- No confirmation turn from the other agent. If Davis wants to continue, he starts a new session.
- Post-completion reopening is **not supported in v1**.

**Orchestrator control flow (while loop + `isPaused` flag):**

The orchestrator is a sequential `while` loop, not a state machine. There are only two meaningful states: running and paused. The `session_status` field in `session.json` (`active`/`paused`/`completed`) is the canonical representation.

```
while (turnCount < maxTurns && !endRequested) {
  invoke agent (with 120s timeout)
  validate output (retry once if invalid)
  write canonical turn (atomic: temp → rename)
  update session.json

  if status == needs_human:
    set isPaused, update session.json → 'paused'
    await humanResponsePromise  ← resolved by POST /api/interject
    write human turn, update session.json → 'active'
    continue with same agent (R11)

  if status == done: break

  drain interjection queue (one item, then re-check)
}

generate artifacts (best-effort decisions.md extraction)
update session.json → 'completed'
remove lockfile
```

Key rules:
- **Unsolicited interjections** are pushed to a plain array by the HTTP server. The loop drains one per turn boundary.
- **Paused-state responses** bypass the array. `POST /api/interject` directly resolves the orchestrator's `humanResponsePromise`, persists the human turn, and the loop resumes. This avoids deadlock.
- **`DONE` is terminal.** No reopening in v1. Start a new session to continue.

**`decisions` field:** Optional. If present, must be an array of strings. Agents may include decisions in frontmatter or just mention them in the body text. `decisions.md` extraction is best-effort.

**Human turn schema:**
```yaml
---
id: turn-0005-human
turn: 5
from: human
timestamp: 2026-03-23T15:00:00Z
status: complete        # human turns are always 'complete' unless ending session
---
```
- Human turns can set `status: done` to end the session immediately.
- Human turns cannot set `status: needs_human` or `status: error`.
- The orchestrator generates the frontmatter; the human only provides the content body.

**`session.json`:**
```json
{
  "id": "<session-uuid>",
  "topic": "Plan Phantom wallet deep-link support",
  "mode": "planning",
  "max_turns": 20,
  "target_repo": "/absolute/path/to/repo",
  "created": "2026-03-23T14:00:00Z",
  "session_status": "active",
  "current_turn": 4,
  "next_agent": "codex",
  "port": 49152
}
```
`session_status` values: `active`, `paused`, `completed`. Config fields (`topic`, `mode`, `max_turns`, `target_repo`, `created`) are set once at creation. Runtime fields (`session_status`, `current_turn`, `next_agent`, `port`) are updated at turn boundaries. One file, one schema, one read on startup.

**`POST /api/interject` response format:**
```json
// Success (200):
{ "ok": true }

// Error (400):
{ "error": "Content is required" }
// or content too long:
{ "error": "Content exceeds 10000 character limit" }
```
No queue position, no queued/injected distinction. The interjection appears in the transcript on the next poll (within 3 seconds).

**Interjection queue:** A plain array on the orchestrator. No max size, no HTTP 429. If the user floods the queue, all items are processed one per turn boundary. At 20 max turns the context fits easily; no overflow concern.

**Graceful shutdown:**
End-session sets a flag on the orchestrator. The loop checks the flag at each turn boundary and exits cleanly. Ctrl+C is trapped via SIGINT handler: the handler updates `session.json` to `completed`, removes the lockfile, and exits. If the trap fails (e.g., double Ctrl+C), the process dies hard and crash recovery (Phase 3) handles the orphaned session.

**Prompt governance asymmetry (known limitation):**
Claude Code loads the target repo's `CLAUDE.md` if one exists. Codex is isolated via `--no-project-doc`. This means the two agents do not operate under identical prompt governance. The session role prompt is explicit about output format (YAML frontmatter) and takes priority over repo-level instructions. If a repo's `CLAUDE.md` contains instructions that conflict with the session role prompt (e.g., "never output YAML"), the orchestrator's validation will catch malformed output and retry. If contamination proves persistent, a future version can invoke Claude from an isolated cwd or investigate suppression flags.

### Failure Handling

| Scenario | Action |
|---|---|
| Output file missing | Retry once → error turn → pause for human (Phase 2+) or exit loop (Phase 1) |
| Invalid frontmatter | Retry once → error turn (raw content preserved) → pause/exit |
| Empty output | Treat as missing → retry once → error turn → pause/exit |
| CLI nonzero exit | Retry once → error turn with exit details → pause/exit |
| Turn timeout (120s) | Kill process → retry once → error turn → pause/exit |
| Malformed interjection | HTTP 400, no turn persisted |
| Orchestrator crash | On restart, check `session_status` in `session.json` — only resume sessions where `session_status: active` or `session_status: paused`. See Phase 3 for full recovery semantics. |

Retry policy: 1 automatic retry per turn, immediate (no backoff). Error turns are canonical and visible in the UI.

**Phase-specific error behavior:** In Phase 1 (headless), "pause" means exit the loop — there is no HTTP server to receive human input. Phase 2 adds the pause/resume mechanism via `humanResponsePromise` resolved by `POST /api/interject`. The Protocol Clarifications control flow pseudocode describes the full Phase 2+ behavior.

**Session-level status updates:** The orchestrator updates `session_status` in `session.json` (atomic write) at each turn boundary:
- Session start: `active`
- `needs_human` pause: `paused`
- Human resumes: `active`
- Session ends (artifacts generated): `completed`

`session.json` is the single source of truth for session config and runtime state.

### Security Hardening

**Must-build for v1:**

| Concern | Mitigation |
|---|---|
| **HTTP server bind address** | Bind to `127.0.0.1` only |
| **CORS / Origin checking** | Validate `Origin` header on every request; reject non-localhost origins |
| **Never `shell: true`** | `child_process.spawn` with argument arrays only. Security invariant. |
| **Path traversal** | Validate `from` field with strict regex `/^(claude\|codex\|human\|system)$/`. Orchestrator owns all filenames. |
| **YAML safety** | Configure `gray-matter` with `js-yaml` `DEFAULT_SCHEMA`. |
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

### Role Prompts

Each agent receives a role prompt as the first section of the assembled prompt file. Role prompts are defined as template strings in `src/context.js` (no separate files for v1). Each prompt has three responsibilities: (1) establish the agent's identity and behavioral constraints, (2) define the output format (YAML frontmatter + markdown), and (3) set the collaboration tone.

**Claude role prompt (planning mode):**
```
You are Claude, participating in a structured planning conversation with another AI agent (Codex).
You are collaborating on: {{topic}}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "claude"), timestamp (ISO-8601), status (complete | needs_human | done).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and ready for implementation, set status: done.
- Do NOT include anything before the opening --- of the frontmatter.
```

**Codex role prompt (planning mode):**
```
You are Codex, participating in a structured planning conversation with another AI agent (Claude).
You are collaborating on: {{topic}}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "codex"), timestamp (ISO-8601), status (complete | needs_human | done).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and ready for implementation, set status: done.
- Do NOT include anything before the opening --- of the frontmatter.
```

The prompts are intentionally symmetric — the only differences are the agent name and `from` field value. Future modes (`code_review`, `debate`) will have distinct prompts with mode-specific instructions.

**`{{topic}}`** is interpolated from `session.json` at context assembly time.

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
├── session.js          # Create .acb/sessions/<id>/ dir structure, write session.json, add .acb/ to .gitignore
├── agent.js            # Invoke any CLI agent (Claude or Codex) with config map, stdin pipe, timeout
├── validation.js       # Parse YAML frontmatter, validate required fields
└── context.js          # Assemble prompt from session brief + all turns
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
// On completion, log session path and exit
// (decisions.md extraction is inline in the orchestrator exit path)
```

**`src/orchestrator.js`** — Turn loop (Phase 1 scope):
```javascript
// while (turnCount < maxTurns) {
//   1. Determine next agent (alternating)
//   2. Call context.assemble(session) to build prompt
//   3. Call agent.invoke(agentName, promptPath, session) — includes 120s timeout
//   4. If timeout or error: retry once (same prompt), then write error turn + exit loop
//   5. Call validation.validate(output) — if invalid: retry once, then error turn + exit loop
//   6. Orchestrator assigns canonical turn number, id, filename (ignores agent values)
//   7. Write canonical turn file to turns/ (atomic: write temp → rename)
//   8. Update session.json (current_turn, next_agent) via atomic write
//   9. Check status:
//      - 'done': break (session ends immediately)
//      - 'needs_human': log warning, exit loop (no HTTP server in Phase 1)
//      - 'complete': continue
// }
// Generate decisions.md (best-effort extraction from turn frontmatter)
// Update session.json → 'completed', remove lockfile
//
// NOTE: Phase 2 adds: isPaused flag, humanResponsePromise, interjection queue
//       draining, endRequested flag, and needs_human pause/resume via HTTP server.
```

**`src/agent.js`** — Unified agent invocation:
```javascript
// Agent config map:
// const AGENTS = {
//   claude: { cmd: 'claude', args: ['--print'], captureStdout: true },
//   codex:  { cmd: 'codex',  args: ['exec', '--full-auto', '--no-project-doc',
//             '--skip-git-repo-check', '-o', outputPath], captureStdout: false }
// }
//
// invoke(agentName, promptPath, session):
//   Write assembled prompt to runtime/prompt.md
//   Open prompt.md as a readable stream for stdin
//   const config = AGENTS[agentName]
//   spawn(config.cmd, config.args, {
//     cwd: targetRepo,
//     stdio: [promptStream, 'pipe', 'ignore']  // stderr ignored (Codex thinking tokens)
//   })
//   NEVER use shell: true — security invariant
//   Timeout: setTimeout + process.kill() after 120s
//   If captureStdout: write stdout to runtime/output.md
//   Else: read -o output file
//   Return { exitCode, output, timedOut }
```

**`src/validation.js`**:
```javascript
// Parse frontmatter with gray-matter (explicit DEFAULT_SCHEMA)
// Check required fields: id, turn, from, timestamp, status
// Validate status enum: complete | needs_human | done | error
// Validate from matches expected agent (strict regex: /^(claude|codex|human|system)$/)
// If decisions present, validate it's an array (optional field)
// Log but IGNORE agent-provided turn/id values (orchestrator is authority)
// Return { valid, errors, data, content }
```

**`src/context.js`**:
```javascript
// Read session.json for topic and mode
// Read all existing turn files from turns/ (sorted by turn number)
// Concatenate: role prompt + session brief + all turns + response format instructions
// Return assembled prompt string
// At 20 max turns (~30KB), no truncation needed. Add if max_turns grows beyond ~30.
```

**Artifact generation** (inline in orchestrator exit path — no separate file needed):
```javascript
// decisions.md (best-effort, pure file I/O, no CLI call):
//   Read all turn files, look for `decisions` arrays in frontmatter
//   If any found: write as ordered list with turn number and agent attribution
//   If none found: skip (agents may not have used the optional field)
//   No final-summary.md in v1 — Davis can summarize manually if needed.
```

- [ ] `package.json` with `bin` field and `gray-matter` dependency
- [ ] `bin/acb` — CLI entry point that resolves `src/index.js` from install location
- [ ] `src/index.js` — parse CLI args with hardcoded defaults, acquire lockfile, init session, run loop, extract decisions, release lockfile
- [ ] `src/session.js` — write `.acb/lock` (error if exists), create `.acb/sessions/<id>/`, write `session.json`, add `.acb/` to `.gitignore`
- [ ] `src/agent.js` — unified agent invocation with config map (Claude: `--print`, Codex: `exec --full-auto --no-project-doc --skip-git-repo-check -o`), stdin pipe, 120s timeout, stderr ignored
- [ ] `src/validation.js` — YAML frontmatter parsing (safe schema), required fields check, optional `decisions` validation
- [ ] `src/context.js` — context assembly (all turns, no truncation at 20 turns)
- [ ] `src/orchestrator.js` — turn loop with retry logic (1 retry), error turn generation, `done` = immediate exit
- [ ] Manual test: `cd` into a test repo, run `acb --topic "Test conversation" --first claude`, verify `.acb/sessions/` appears with turn files

**Acceptance criteria:**
- [ ] Running `acb --topic "Plan a REST API" --first claude` from any repo creates `.acb/sessions/<id>/` with properly structured turn files
- [ ] Turn files have valid YAML frontmatter with required fields (decisions is optional)
- [ ] Orchestrator assigns turn numbers/IDs/filenames (not agents)
- [ ] Agents alternate turns correctly (claude → codex → claude → ...)
- [ ] Both agents can read and reference files in the target repo
- [ ] Session stops at max turn limit or when any agent says `done`
- [ ] Agent hangs are killed after 120s timeout and retried once
- [ ] Invalid agent output is detected, retried once, then produces a visible error turn
- [ ] `decisions.md` is generated (best-effort) at session end
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
<!-- Use session_status from /api/turns response for paused/active state -->
<!-- No visibilitychange handler in v1 — zero-cost localhost polling -->
<!-- Renders: chat transcript with [CLAUDE], [CODEX], [DAVIS], [SYSTEM] labels -->
<!-- Text input + send button — disable on click, re-enable on response -->
<!-- Yellow banner when session_status from /api/turns response is 'paused' -->
<!-- "End Session" button in header -->
<!-- Interjection appears on next poll (3s). No optimistic rendering in v1. -->
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
- [ ] `src/orchestrator.js` — add `isPaused` flag, `humanResponsePromise`, `needs_human` pause/resume (direct resume path, no deadlock)
- [ ] `src/orchestrator.js` — add `endRequested` flag checked at turn boundary
- [ ] `src/orchestrator.js` — add interjection queue draining at turn boundaries
- [ ] `src/orchestrator.js` — update `session.json` `session_status` to `paused`/`active` at transitions
- [ ] `src/orchestrator.js` — deterministic turn resumption (R11 — same agent resumes after escalation)
- [ ] `src/ui/index.html` — recursive setTimeout polling, fetchInFlight guard
- [ ] `src/ui/index.html` — chat transcript with agent labels, turn numbers, timestamps
- [ ] `src/ui/index.html` — interjection input with disable-on-click
- [ ] `src/ui/index.html` — escalation banner using `session_status` from `/api/turns` response
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
// 1. Scan .acb/sessions/ for dirs where session.json has session_status: 'active' or 'paused'
//    (NOT 'completed' — that means the session finished normally)
//    NOTE: Do NOT use per-turn status: 'complete' to judge session completion.
// 2. Also check: does .acb/lock exist? If yes, another session may be running — skip.
// 3. For each recoverable session:
//    a. Find the last canonical turn in turns/ (by turn number)
//    b. Read session.json for next_agent and current_turn
//    c. Discard any incomplete runtime/ output
//
// Recovery behavior (non-interactive):
// - If exactly 1 recoverable session: auto-resume it (print: "Resuming session <id> from turn <N>")
// - If multiple recoverable sessions: print the list and exit with:
//     "Multiple interrupted sessions found. Use --resume <session-id> to resume one."
// - If --resume <session-id> flag is provided: resume that specific session
// - If no recoverable sessions: proceed to create a new session normally
```

- [ ] `src/recovery.js` — scan `.acb/sessions/` for `session.json` with `session_status: active|paused`, determine resume point
- [ ] `src/index.js` — call recovery check on startup; auto-resume single session, list multiple, accept `--resume <id>`
- [ ] SIGINT handler: trap Ctrl+C, update `session.json` to `completed`, remove lockfile, exit
- [ ] Manual test: kill orchestrator mid-session, restart `acb`, verify auto-resume from last canonical turn
- [ ] Manual test: verify completed sessions are not flagged for recovery
- [ ] Manual test: create two interrupted sessions, verify `acb` prints list and exits

**Acceptance criteria:**
- [ ] Restarting `acb` after a crash auto-resumes if exactly one interrupted session exists
- [ ] Multiple interrupted sessions prints a list and requires `--resume <id>`
- [ ] Recovery resumes from the correct turn (last canonical + 1)
- [ ] Incomplete `runtime/` output from before a crash is discarded
- [ ] Completed sessions (`session_status: completed` in `session.json`) are not flagged
- [ ] Ctrl+C updates `session.json` and removes the lockfile

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
- [ ] (R3) Agent context includes all prior turns (no truncation at 20-turn max)
- [ ] (R4) Human interjections via UI are queued and injected at turn boundaries
- [ ] (R5) `status: needs_human` pauses the loop until human responds
- [ ] (R6) Watcher UI at dynamically assigned localhost port shows live transcript with 3-second polling
- [ ] (R7) Session end generates best-effort `decisions.md`
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
| OS arg-length limits for prompts | Medium | Medium | File-based prompt delivery via stdin for both agents. At 20 turns (~30KB), well within limits. |
| Claude loads target repo's CLAUDE.md | Medium | Low | Accepted for v1 — project context is usually helpful. Role prompt overrides output format. Codex is isolated via `--no-project-doc`. Asymmetric prompt governance is a known limitation. Revisit if contamination causes formatting failures. |
| Agent responses are repetitive/low quality | Medium | Medium | Prescriptive role prompts with explicit challenge targets |
| `fs.rename` not atomic on Windows NTFS | Low | Medium | Use write-to-temp + rename pattern; verify behavior |

## Deferred to Future Versions

- `code_review` and `debate` session modes
- Running summary generation (`summary.md`) — not needed at 20-turn max; add when max_turns exceeds ~30
- Attachment handling (copying reference files into session, including them in context)
- Additional frontmatter fields (`model`, `duration_ms`, token metadata)
- Direct API synthesis path for artifacts
- Rich UI: markdown rendering, artifact viewer, session history browser
- Optimized context window strategies (summary + bounded window for large sessions)
- `?after=<turn-id>` incremental fetch on `GET /api/turns` (not needed at 20 turns)
- `response_to` field in turn schema (agents can reference prior turns in body text)
- Codex session resumption (`codex exec resume --last`) instead of fresh invocations per turn — could reduce context assembly overhead
- Codex model and reasoning effort configuration (`--model`, `--config model_reasoning_effort`) as CLI args
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
