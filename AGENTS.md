# AGENTS.md

Instructions for AI coding agents working in this repo.

## What This Is

DEF (Debate Engine Framework) — a CLI that orchestrates turn-based conversations between Claude Code and Codex CLIs. Sessions progress through three phases: **debate → implement → review**. A localhost HTTP server serves a React watcher UI for observation and human interjection.

## Files That Matter

```
bin/def              → CLI entrypoint (ESM shim, tsx loader)
src/index.ts         → Arg parsing, session creation, recovery check
src/orchestrator.ts  → Turn loop: phase-aware invoke → validate → write → repeat
src/agent.ts         → Spawns claude/codex as child processes
src/context.ts       → Assembles phase-aware prompts from system prompt + prior turns
src/validation.ts    → Parses/validates YAML frontmatter from agent output
src/session.ts       → Session CRUD, lockfile, shutdown handler
src/recovery.ts      → Crash recovery: stale lock detection, session resume
src/actions.ts       → Parses def-action blocks and executes file/shell operations
src/server.ts        → HTTP server (localhost-only) serving API + React UI
src/util.ts          → atomicWrite (write→fsync→rename), isProcessAlive
src/ui/              → React frontend (Vite, TypeScript, Tailwind v4, shadcn/ui)
```

Session directories live at `.def/sessions/<uuid>/` with:
- `turns/` — canonical turn files (turn-NNNN-agent.md)
- `artifacts/` — generated outputs (decisions.md, action-results-NNNN.json)
- `runtime/` — ephemeral prompt.md and output.md
- `logs/` — per-invocation debug logs
- `session.json` — authoritative session state

## Hard Rules

### Do Not
- **Do not hand-author canonical turn metadata.** The orchestrator overwrites `id`, `turn`, `from`, and `timestamp` regardless of what agents emit.
- **Do not emit `status: error`.** Only the orchestrator writes error turns. Agents use `complete`, `needs_human`, `done`, or `decided`.
- **Do not assume a clean git tree.** The worktree may have unrelated staged/unstaged changes. Never revert, discard, or commit changes you didn't make.
- **Do not commit to `main`, `master`, `dev`, or `stage`.** Use feature branches.
- **Do not bypass frontmatter security.** `gray-matter`'s JS/CoffeeScript engines are disabled. Frontmatter is written manually via `yaml.dump()`, not `matter.stringify()`, to prevent injection via embedded `---` blocks.

### Do
- **Use `atomicWrite()` from `src/util.ts` for session.json, turn files, and artifacts.** These are the crash-safety boundary. Other files (prompt.md, .gitignore, debug logs) use plain `writeFile`.
- **Use conventional commits:** `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- **Add tests when adding backend logic.** Tests use the Node.js built-in test runner via tsx: `tsx --test src/__tests__/*.test.ts`. No mocking frameworks.
- **Update session state via `session.update()`**, never by writing `session.json` directly.
- **Record durable choices in `decisions`.** Architecture choices, accepted tradeoffs, scope cuts, and protocol interpretations that later turns must preserve. These entries survive context truncation and are compiled into the final decisions log.

## Session Lifecycle

Sessions progress through three phases:

### Debate Phase
Agents alternate turns debating a topic. When an agent believes consensus is reached, it emits `status: decided`. The other agent then either confirms (also emits `decided`) or contests (emits `complete`, returning to debate). Consensus requires both agents to agree. The debate turn budget keeps ticking during contested consensus (no reset).

### Implement Phase
After consensus, the agent specified by `--impl-model` (default: `claude`) receives the debate decisions and produces structured `def-action` blocks. DEF parses and executes these actions (write-file, edit-file, shell, mkdir) with path traversal and symlink protection. The implementing agent never directly touches the filesystem.

### Review Phase
The non-implementing agent reviews the implementation. It can approve (`status: done`) or request fixes (`status: complete` with feedback). Fix requests cycle back to the implement phase. This loops until the reviewer approves or the `--review-turns` limit (default: 6) is reached.

## Status Semantics

### Turn Schema
```yaml
---
id: turn-0001-claude        # Orchestrator-assigned
turn: 1                      # Orchestrator-assigned
from: claude                 # claude | codex | human | system
timestamp: 2026-03-23T...   # Orchestrator-assigned
status: complete             # complete | needs_human | done | decided
decisions:                   # Optional, array of strings
  - "Key decision made"
---
```

### Status Rules
- **`complete`** — default. Turn is done, conversation continues.
- **`decided`** — signals the agent believes consensus is reached. Downgraded to `complete` if `turnCount < 2`. Both agents must emit `decided` to trigger the implement phase transition.
- **`done`** — signals end of conversation. Downgraded to `complete` if `turnCount < 2`. In review phase, means the reviewer approves the implementation.
- **`needs_human`** — pauses the session. With a UI server, waits for human input; the **same agent** resumes after the human turn. Without UI, the session exits.
- **`error`** — orchestrator-only. Never emitted by agents.

### Retry & Error Handling
- **Agent invocation** gets one automatic retry on failure (timeout, non-zero exit, empty output).
- **Frontmatter validation** gets one retry (re-invokes the agent) on parse/validation failure.
- After both retries fail, an `error` turn is written and the session pauses (with UI) or exits (without UI).

## Action Block Protocol

During the implement phase, agents produce structured action blocks in their turn content:

```markdown
```def-action
type: write-file
path: relative/path/to/file.js
---
file content here
```
```

### Supported Action Types
| Type | Required Fields | Description |
|------|----------------|-------------|
| `write-file` | `path`, body after `---` | Create or overwrite a file |
| `edit-file` | `path`, `search`, body after `---` | Replace first occurrence of search string |
| `shell` | `cmd`, optional `cwd` | Run a shell command (60s timeout, 5MB output cap) |
| `mkdir` | `path` | Create a directory (recursive) |

### Security Constraints
- All paths validated against traversal (`..`) and symlink escape
- Absolute paths rejected
- Shell commands logged before execution
- No delete-file, git, or network operations

## Context Assembly
- `context.ts` builds prompts with a **400K character budget** (~100K tokens).
- Newest turns are prioritized; oldest are dropped first.
- Only `decisions` arrays from truncated turns are preserved in a summary notice — no other content survives truncation.
- Prompts are phase-aware: debate prompts encourage challenge, implement prompts include decisions and action format, review prompts include action results.
- Only `planning` mode is supported. Do not assume other modes exist.

## Agent Invocation
- **Claude:** `claude --print`, prompt piped via stdin (file stream), output captured from stdout.
- **Codex:** `codex exec --full-auto --skip-git-repo-check -o <path>`, prompt via stdin, output read from file.
- Windows: agents spawn with `shell: true` because npm CLIs are .cmd shims.
- **180s timeout** → SIGTERM → 5s grace → SIGKILL.
- **5MB output cap** — child is killed if stdout exceeds this.

## UI & API

The watcher UI is a React SPA. Key dependencies beyond React: `radix-ui`, `shadcn/ui`, `lucide-react`, `sonner`, `next-themes`, `clsx`, `class-variance-authority`, `tailwind-merge`.

### API Endpoints (localhost-only)
- `GET /api/turns` — returns all turns, session status, phase, and thinking state
- `POST /api/interject` — inject a human message (`{ content: string }`, 10K char limit, JSON Content-Type required)
- `POST /api/end-session` — request graceful session end

### Server Security
- Binds to `127.0.0.1` only
- Host and Origin header validation (DNS rebinding / CORS)
- Directory traversal protection on static files
- JSON Content-Type required on POST (CSRF defense)

## Recovery & Crash Safety
- SIGINT sets session to `interrupted` and releases the lockfile.
- On startup, `recovery.ts` checks for interrupted/active/paused sessions.
- Stale lockfiles are detected by PID liveness check.
- On resume: orphaned `.tmp` files in `turns/` are cleaned, runtime files are deleted.
- Ephemeral state (`pendingDecided`, `reviewTurnCount`) is reconstructed from turn history on recovery.

## Commands
```sh
npm start -- --topic "Your topic"                    # Run the CLI
npm start -- --topic "..." --impl-model codex        # Use Codex for implementation
npm start -- --topic "..." --review-turns 10         # Set review loop limit
npm test                                              # Run tests (tsx)
npm run typecheck                                     # Type-check (tsc --noEmit)
npm run dev:ui                                        # Dev UI (hot reload)
npm run build:ui                                      # Build UI
npm install                                           # Full install (triggers UI build via "prepare")
```
