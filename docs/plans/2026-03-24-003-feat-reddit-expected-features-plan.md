---
title: "feat: Reddit-expected features for DEF"
type: feat
status: completed
date: 2026-03-24
deepened: 2026-03-24
---

# feat: Reddit-Expected Features for DEF

## Overview

This document captures the features technical early adopters are likely to expect from DEF once they understand the current shape of the product: a turn-based Claude-vs-Codex CLI with a watcher UI, worktree-backed implementation, and automatic draft PR creation. This is not a survey of Reddit posts. It is a product-direction document grounded in the current repository and in the expectations users usually bring to AI coding tools.

The list intentionally excludes resume or replay UX. The product direction is that sessions remain single-use, and the human explicitly rejected adding resume.

## Current Baseline

DEF already has a strong core:

- CLI argument parsing in `src/cli.ts`
- Phase-aware prompt assembly in `src/context.ts`
- hardcoded Claude/Codex agent execution in `src/agent.ts`
- isolated implementation worktrees and automatic commits in `src/worktree.ts`
- automatic draft PR creation in `src/pr.ts`
- a localhost watcher server in `src/server.ts`
- durable session state in `src/session.ts`

That baseline is enough for users to immediately ask for polish, configurability, visibility, and safer automation controls.

## Feature Table

| Feature | Why users will expect it | Current repo evidence | Effort |
|---|---|---|---|
| Config file support | Power users will not want to repeat the same flags on every run. | `src/cli.ts:2-8` defines argument fields and `src/cli.ts:18-37` parses flags directly, with no project or user config layer. | Small |
| Token and cost tracking | Users will ask "how much did that debate cost?" as soon as they run longer sessions. | `src/trace.ts` has no token or cost accounting, while `src/context.ts:24-28` already treats context budget as an explicit resource concern. | Small-Medium |
| Exportable / shareable transcripts | Interesting debates are naturally shareable artifacts; users will want one-command export. | `src/orchestrator.ts:939-966` already compiles plan summaries, and session turns are persisted under `.def/sessions/<id>/turns/`, but there is no export command or static transcript output. | Small-Medium |
| Custom personas / role presets | Users will want one agent to optimize for security, performance, DX, or skepticism. | Prompt assembly is centralized in `src/context.ts:30-70` and `src/context.ts:156-166`, but there is no user-supplied persona layer. | Small |
| Pluggable model / provider support | AI tool users expect Gemini, local models, and bring-your-own-provider support. | `src/agent.ts:34-55` hardcodes only `claude` and `codex`, and `src/agent.ts:67` rejects anything else. | Large |
| Session history browser / search | Once sessions accumulate, users will expect a way to find prior debates and implementation runs. | `src/session.ts:53-92` and `src/session.ts:116-128` persist durable session state atomically, but there is no CLI or UI history layer over stored sessions. | Small-Medium |
| Approval gates / safer automation controls | Users will want confirmation points before commits, pushes, or PR creation touch a real repo. | `src/worktree.ts:98-119` stages and commits changes automatically; `src/orchestrator.ts:498-500` commits implementation turns; `src/pr.ts:46-54` and `src/orchestrator.ts:597-600` push branches and create draft PRs. | Small-Medium |
| Background completion notifications / long-run visibility | If sessions stay single-use, users still need better awareness for long-running work without staring at the terminal. | `src/server.ts:63-69` already exposes a localhost watcher URL, and `src/server.ts:147-149` plus `src/server.ts:361` show an event-driven server shape that could support richer completion signaling. | Small-Medium |

## Feature Notes

### 1. Config File Support

This should be a basic project-level and user-level defaults layer, not an overengineered settings system. A simple `def.config.json` would cover most demand. The important behavior is precedence: CLI flags override config, config overrides built-in defaults.

This is a better first investment than more "AI" features because it reduces friction for every existing workflow.

### 2. Token and Cost Tracking

Users will not trust an automation loop they cannot price. The current system already exposes duration and phase state in the session flow, but it does not expose the economic side of execution.

The useful product shape is:

- per-turn token and cost metadata
- cumulative session total
- optional final summary in the CLI and watcher UI

### 3. Exportable / Shareable Transcripts

This is an obvious growth feature because the core artifact is already a structured conversation. If DEF produces good debates, users will want to share them with teammates or post excerpts publicly.

The minimum viable version is a single compiled markdown export. Static HTML can come later if the plain markdown export proves useful.

### 4. Custom Personas / Role Presets

Without personas, the two-agent setup risks feeling interchangeable. Users will expect a way to bias each agent toward a meaningful perspective such as:

- security reviewer
- performance skeptic
- maintainability-focused staff engineer
- strict product scoper

This fits the existing prompt assembly model cleanly and does not require changing session mechanics.

### 5. Pluggable Model / Provider Support

This is not a quick win, but it is a repeated expectation for AI tooling. Hardcoding two CLIs is fine for the initial product, but it will feel closed once people try to apply DEF in environments where Claude or Codex are not the preferred tools.

The right shape is a provider abstraction around invocation, response normalization, and capability flags rather than adding one-off branches for each new CLI.

### 6. Session History Browser / Search

The repository already keeps durable artifacts, which means users will reasonably assume there is a way to inspect them later. Right now, that assumption is false unless they manually dig through `.def/sessions/`.

The first pass can be a CLI listing with topic, date, phase reached, and outcome. Search and richer UI filtering can come after that.

### 7. Approval Gates / Safer Automation Controls

This is the most important pushback against purely "feature" thinking. DEF already performs repo-affecting actions automatically. That means users will not only ask what it can do, they will ask how to keep it from doing too much.

Likely expectations include:

- preview before commit
- optional confirmation before push
- optional confirmation before PR creation
- clearer dry-run behavior

This improves trust more than another flashy capability would.

### 8. Background Completion Notifications / Long-Run Visibility

The absence of resume does not remove the need for better operational visibility. If a plan or implementation run takes several minutes, users will expect something better than periodically checking the terminal.

This can stay consistent with the single-use session model:

- watcher UI shows completion more prominently
- optional desktop or terminal notification on completion or stall
- clearer "agent is still active" state during long turns

## Prioritized Rollout

### Quick Wins

- Config file support
- Custom personas / role presets

These are small, easy to explain, and improve the product immediately without reopening core architecture.

### Core Polish

- Token and cost tracking
- Approval gates / safer automation controls
- Background completion notifications / long-run visibility

These are the features most likely to affect trust, daily usability, and willingness to run DEF against a real codebase.

### Growth Features

- Exportable / shareable transcripts
- Session history browser / search

These improve retention and make the product easier to demonstrate, revisit, and discuss.

### Horizon

- Pluggable model / provider support
- Multi-agent debates (3+ participants)

These are meaningful future bets, but they are not the first things to ship if the goal is meeting baseline user expectations efficiently.

## Horizon Item: Multi-Agent Debates

Users will ask for "Claude vs Codex vs Gemini" because it is a compelling demo. But the current architecture is intentionally two-agent:

- `src/agent.ts` models only `claude` and `codex`
- the orchestrator alternates turns between two participants
- consensus semantics are built around bilateral agreement

That makes multi-agent debate a legitimate future direction, but not a baseline expectation to prioritize ahead of configurability, cost visibility, and safer automation.
