---
title: "feat: Reddit-expected features for DEF"
type: feat
status: plan
date: 2026-03-24
---

# feat: Reddit-Expected Features for DEF

## Overview

Features that technical early adopters on Reddit (r/programming, r/ChatGPT, r/LocalLLaMA) will likely expect from DEF based on common sentiment patterns around AI developer tools. These are framed as probable user expectations grounded in the current codebase -- not cited Reddit research.

DEF currently ships with adaptive model tiering, worktree isolation, a live watcher UI, and draft PR creation. The features below represent gaps that power users will surface quickly.

## Feature Table

| # | Feature | Why Users Expect It | Repo Evidence | Effort |
|---|---------|-------------------|---------------|--------|
| 1 | Config file support | Power users won't retype 8 flags every run | `src/cli.ts` is flag-only, no config file reader | Small |
| 2 | Token & cost tracking | "How much did that debate cost me?" is universal | `src/trace.ts` tracks timing and exit metadata but not tokens or spend | Small-Med |
| 3 | Exportable / shareable transcripts | Organic sharing drives adoption; debates are inherently shareable | Turns persist as clean markdown in `.def/sessions/<id>/turns/`, but no export command | Small-Med |
| 4 | Custom personas / role presets | "Make one focus on security, the other on performance" | Prompt assembly centralized in `src/context.ts`, no user-configurable specialization | Small |
| 5 | Pluggable model / provider support | r/LocalLLaMA wants Ollama; r/programming wants Gemini | Agent invocation hardcoded in `src/agent.ts` to `claude` and `codex` CLIs | Large |
| 6 | Session history browser / search | "Where did my past debates go?" | Sessions persist in `.def/sessions/` with full turn history, but no listing or search UX | Small-Med |
| 7 | Approval gates / safer automation controls | "Will this commit to my repo without asking?" | Worktree creation (`src/worktree.ts`), commits, and draft PRs (`src/pr.ts`) happen automatically | Small-Med |
| 8 | Background completion notifications | Long-running sessions need visibility without requiring the terminal to stay focused | Watcher UI in `src/server.ts` serves live data, session state in `src/session.ts`, but no push notifications or completion signals | Small-Med |
| *Horizon* | Multi-agent debates (3+) | Viral "Claude vs Codex vs Gemini" demos | Orchestrator (`src/orchestrator.ts`) is strictly 2-agent; agent spawn in `src/agent.ts` is pairwise | Large |

## Feature Details

### 1. Config File Support

**Problem:** `src/cli.ts` accepts `--topic`, `--mode`, `--max-turns`, `--first`, `--impl-model`, `--no-fast`, `--no-pr`, `--review-turns`, and more. Typing these repeatedly is friction.

**Expected behavior:** A `.defrc` or `def.config.json` in the project root (with global fallback at `~/.config/def/config.json`) sets defaults. CLI flags override file values. No new dependencies needed -- a simple JSON reader suffices given the 5-dependency constraint.

### 2. Token & Cost Tracking

**Problem:** `src/trace.ts` records elapsed time and exit codes per turn, but not input/output token counts or estimated cost. Users running multi-turn debates with full-capability models will immediately ask what it cost.

**Expected behavior:** Parse token usage from agent CLI stdout during execution in `src/agent.ts`. Aggregate in `session.json`. Display cumulative cost in the watcher UI status bar (`src/ui/src/components/status-bar.tsx`) and in the CLI session summary.

### 3. Exportable / Shareable Transcripts

**Problem:** Turn files are clean markdown with YAML frontmatter stored under `.def/sessions/<id>/turns/`, but there's no way to produce a single shareable artifact. The watcher UI requires a running localhost server.

**Expected behavior:** A `def export <session-id>` command that concatenates turns into a single markdown document or renders a self-contained static HTML page. A "share" button in the watcher UI that triggers the same export. This enables organic Reddit/Twitter sharing of interesting debates.

### 4. Custom Personas / Role Presets

**Problem:** `src/context.ts` assembles phase-aware prompts with a fixed structure. There's no user-facing way to inject custom role instructions like "You are a senior security engineer" or "Prioritize latency and throughput."

**Expected behavior:** `--persona-claude <file>` / `--persona-codex <file>` CLI flags (or a `personas:` section in the config file from feature #1) that prepend custom instructions to each agent's system prompt during context assembly.

### 5. Pluggable Model / Provider Support

**Problem:** `src/agent.ts` spawns `claude` and `codex` as hardcoded child processes. The agent layer is tightly coupled to these two CLI tools.

**Expected behavior:** A provider abstraction (interface with `spawn()`, `parseResponse()`, model tier mapping) that lets users configure alternative CLIs or local model endpoints. Even if only Claude and Codex ship on day one, the abstraction signals extensibility and unblocks community contributions.

### 6. Session History Browser / Search

**Problem:** Sessions are stored in `.def/sessions/<uuid>/` with full turn history and `session.json` metadata. But there's no way to list, search, or browse past sessions.

**Expected behavior:** A `def history` command that lists sessions (topic, date, phase reached, turn count, outcome). A `def show <session-id>` that opens the watcher UI against a completed session's data. The data layer already exists -- it just needs a read path.

### 7. Approval Gates / Safer Automation Controls

**Problem:** DEF creates worktrees (`src/worktree.ts`), runs `git commit`, and opens draft PRs (`src/pr.ts`) as part of its normal operation. Users running this on real repositories will want explicit control over when destructive or visible actions happen.

**Expected behavior:** `--dry-run` (show what would be done without acting), `--confirm-before-commit` (pause for user approval before each git operation), and a clear "what will this touch?" preview at session start. These gates build trust before users let DEF operate on production code.

### 8. Background Completion Notifications

**Problem:** DEF sessions can run for many minutes across 10-20+ turns. If the user switches to another terminal tab or window, they have no signal when the session completes or stalls. The watcher UI (`src/server.ts`) serves live data but only if the user is actively watching.

**Expected behavior:** Desktop notifications (via `node-notifier` or native OS APIs) when a session completes, an agent stalls, or a review verdict is reached. Optionally, webhook/Slack integration for CI-like workflows. This gives users confidence that long-running sessions are progressing without requiring them to watch the terminal.

### Horizon: Multi-Agent Debates (3+)

**Problem:** The orchestrator in `src/orchestrator.ts` alternates between exactly two agents in a ping-pong loop. Reddit will ask "what if Claude, Codex, AND Gemini all debated?"

**Why horizon:** This requires orchestrator redesign (turn-order strategy, N-agent consensus detection, UI generalization). It's the flashy feature that generates stars but is not a baseline expectation. Ship the core 8 first; revisit when the provider abstraction (#5) is in place.

## Prioritized Rollout

### Quick Wins (ship first)
- **Config file support (#1)** -- small scope, eliminates daily friction
- **Custom personas (#4)** -- small scope, unlocks creative use cases

### Core Polish (ship next)
- **Token & cost tracking (#2)** -- highest-value single feature for trust
- **Approval gates (#7)** -- required for users to trust DEF on real repos
- **Background notifications (#8)** -- addresses long-run visibility

### Growth Features (ship for virality)
- **Exportable transcripts (#3)** -- enables organic sharing
- **Session history (#6)** -- makes DEF feel like a tool you keep using

### Horizon
- **Pluggable model / provider support (#5)** -- large effort, community-driven
- **Multi-agent debates** -- architectural prerequisite is #5
