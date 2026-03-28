# AGENTS.md

Instructions for AI coding agents working in this repo.

## What This Is

DEF (Dueling Experts Framework) — a CLI that orchestrates turn-based conversations between Claude Code and Codex CLIs. Sessions progress through three phases: **plan → implement → review**. A localhost HTTP server serves a React watcher UI for observation and human interjection. On completion, a draft PR is automatically created via the GitHub CLI.

## Files That Matter

```
bin/def              → CLI entrypoint (ESM shim, tsx loader)
src/index.ts         → Arg parsing, session creation, orchestrator entry
src/cli.ts           → CLI argument parser (--topic, --mode, --no-pr, etc.)
src/orchestrator.ts  → Turn loop: phase-aware invoke → validate → write → repeat
src/agent.ts         → Spawns claude/codex as child processes
src/context.ts       → Assembles phase-aware prompts from system prompt + prior turns
src/validation.ts    → Parses/validates YAML frontmatter from agent output
src/session.ts       → Session CRUD, shutdown handler
src/worktree.ts      → Git worktree lifecycle (create, remove, diff capture, commit)
src/pr.ts            → Push branch + create draft PR via gh CLI
src/server.ts        → HTTP server (localhost-only) serving API + React UI
src/util.ts          → atomicWrite, killChildProcess, isProcessAlive
src/ui/              → React frontend (Vite, TypeScript, Tailwind v4, shadcn/ui)
```

Session directories live at `.def/sessions/<uuid>/` with:
- `turns/` — canonical turn files (turn-NNNN-agent.md)
- `artifacts/` — generated outputs (decisions.md, diff-NNNN.patch, pr-body.md)
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
- **Add tests when adding backend logic.** Tests use the Node.js built-in test runner via tsx. Test files must be listed explicitly in `package.json` (no shell glob) for Windows compatibility.
- **Update session state via `session.update()`**, never by writing `session.json` directly.
- **Record durable choices in `decisions`.** Architecture choices, accepted tradeoffs, scope cuts, and protocol interpretations that later turns must preserve. These entries survive context truncation and are compiled into the final decisions log.
- **Use `killChildProcess()` from `src/util.ts`** to kill agent child processes. It handles Windows process tree cleanup via `taskkill /T /F`.

## Session Lifecycle

Sessions are single-use — there is no resume or recovery mechanism. Each `def` invocation creates a new session. SIGINT marks the session as `completed` and cleans up.

### Plan Phase
Agents alternate turns debating a topic. When an agent believes consensus is reached, it emits `status: decided`. The other agent then either confirms (also emits `decided`) or contests (emits `complete`, returning to debate). Consensus requires both agents to agree. The plan turn count keeps ticking during contested consensus (no reset).

### Implement Phase
After consensus, the agent specified by `--impl` (default: `claude`) receives the plan decisions and runs with full tool access in an isolated git worktree. The agent makes changes directly (reads, writes, edits files, runs commands). After the agent finishes, the orchestrator captures a `git diff` from the worktree, commits changes to the branch, and stores the diff as `artifacts/diff-NNNN.patch` for review.

### Review Phase
The non-implementing agent reviews the implementation. It can approve (`status: done`) or request fixes (`status: complete` with feedback). Fix requests cycle back to the implement phase. This loops until the reviewer approves or the `--review-turns` limit (default: 6) is reached.

### Automatic PR Creation
After the session completes (in `edit` mode), the orchestrator checks if the branch has commits beyond the base ref. If so, it pushes the branch and creates a draft PR via `gh pr create --draft`. The PR body includes the topic, compiled decisions, commit log, and diffstat. Use `--no-pr` to skip this step.

## Status Semantics

### Turn Schema
```yaml
---
id: turn-0001-claude        # Orchestrator-assigned
turn: 1                      # Orchestrator-assigned
from: claude                 # claude | codex | human | system
timestamp: 2026-03-23T...   # Orchestrator-assigned
status: complete             # complete | needs_human | done | decided
phase: plan                  # plan | implement | review
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
- **Agent invocation** gets one automatic retry on failure (timeout, non-zero exit, empty output). Retry is skipped if an end-session request is pending.
- **Frontmatter validation** gets one retry (re-invokes the agent) on parse/validation failure.
- After both retries fail, an `error` turn is written and the session pauses (with UI) or exits (without UI).

## Worktree Isolation

Each edit-mode session's implement phase runs in an isolated git worktree:
- Worktree created at plan→implement transition: `.def/worktrees/<sessionId>`
- Branch: `def/<short-id>-<slugified-topic>`
- `session.target_repo` is swapped to the worktree path during implement/review
- Changes are committed to the branch after each implementation turn
- Worktree cleaned up on session completion or SIGINT; branch preserved for push/PR
- Session fields: `worktree_path`, `branch_name`, `original_repo`, `base_ref` (all nullable)

## Context Assembly
- `context.ts` builds prompts with a **400K character budget** (~100K tokens).
- Newest turns are prioritized; oldest are dropped first.
- Only `decisions` arrays from truncated turns are preserved in a summary notice — no other content survives truncation.
- Prompts are phase-aware: plan prompts encourage challenge, implement prompts include decisions and tool access instructions, review prompts include the git diff.
- Two modes are supported: `edit` (default, includes implement/review phases) and `planning` (plan-only, no implementation).

## Agent Invocation
- **Claude plan/review:** `claude -p "instruction" --allowedTools Read Glob Grep "Bash(gh:*)" "Bash(git log *)" "Bash(git diff *)" "Bash(git show *)" "Bash(ls *)" --dangerously-skip-permissions`, prompt piped as stdin context. Read-only tool access — agents can observe files, search code, browse git history, and query GitHub, but cannot modify anything.
- **Claude implement:** `claude -p "instruction" --allowedTools "*" --dangerously-skip-permissions`, prompt piped as stdin context, full tool access.
- **Codex plan/review:** `codex exec --sandbox read-only --ephemeral --skip-git-repo-check -o <path>`, prompt via stdin, output read from file. Read-only sandbox — no file modifications.
- **Codex implement:** `codex exec --full-auto --ephemeral --skip-git-repo-check -o <path>`, prompt via stdin, output read from file. Full workspace-write tool access.
- Windows: agents spawn with `shell: true` because npm CLIs are .cmd shims. Process kill uses `taskkill /T /F` for proper tree cleanup.
- **Three model tiers:** full (opus/gpt-5.4), mid (sonnet), fast (haiku/gpt-5.1-codex-mini). Review phase uses mid by default; consensus confirmation uses fast. `--no-fast` forces all turns to full tier.
- **300s timeout** (plan/review), **900s timeout** (implement) → SIGTERM → 5s grace → SIGKILL.
- **5MB output cap** — child is killed if stdout exceeds this.

## UI & API

The watcher UI is a React SPA. Key dependencies beyond React: `radix-ui`, `shadcn/ui`, `lucide-react`, `sonner`, `next-themes`, `clsx`, `class-variance-authority`, `tailwind-merge`.

### API Endpoints (localhost-only)
- `GET /api/turns` — returns all turns, session status, phase, and thinking state
- `POST /api/interject` — inject a human message (`{ content: string }`, 10K char limit, JSON Content-Type required)
- `POST /api/end-session` — request graceful session end (kills running agent, stops loop)

### Server Security
- Binds to `127.0.0.1` only
- Host and Origin header validation (DNS rebinding / CORS)
- Directory traversal protection on static files
- JSON Content-Type required on POST (CSRF defense)

## Commands
```sh
npm start -- --topic "Your topic"                    # Run the CLI
npm start -- --topic "..." --impl codex        # Use Codex for implementation
npm start -- --topic "..." --review-turns 10         # Set review loop limit
npm start -- --topic "..." --no-pr                   # Skip draft PR creation
npm test                                              # Run tests (tsx)
npm run typecheck                                     # Type-check (tsc --noEmit)
npm run dev:ui                                        # Dev UI (hot reload)
npm run build:ui                                      # Build UI
cd src/ui && npm run test:e2e                         # Run Playwright e2e tests (mock mode)
cd src/ui && npm run test:e2e:ui                      # Playwright e2e (interactive UI mode)
npm install                                           # Full install (triggers UI build via "prepare")
```
