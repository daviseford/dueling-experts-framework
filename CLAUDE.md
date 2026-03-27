# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](./AGENTS.md) for full architecture, conventions, and agent operating rules.

## Quick Reference

```sh
npm start -- --topic "Your topic"    # Run DEF
npm test                              # Run tests (node:test via tsx)
npm run typecheck                     # Type-check with tsc --noEmit
npm run dev:ui                        # Dev UI with hot reload
npm run build:ui                      # Build UI
cd src/ui && npm run test:e2e         # Run Playwright e2e tests (mock mode)
cd src/ui && npm run test:e2e:ui      # Playwright e2e with interactive UI
```

Run a single test file: `tsx --test src/__tests__/validate.test.ts`

## Important: "Agents" Means the Programmatic Agents

This repo IS a multi-agent orchestrator (DEF). When discussing agents, reviewers, or tool access in this codebase, we are **always** referring to the programmatically spawned agents defined in `src/agent.ts` — NOT Claude Code itself. Changes to agent capabilities (e.g., adding tools, modifying permissions) must be made in the source code (`src/agent.ts`, `src/context.ts`, etc.), **never** by editing Claude Code settings files.

## Key Constraints

- **Backend is TypeScript (ESM).** Node.js 20+, run via `tsx`, no build step. Type-check with `tsc --noEmit`.
- **Five runtime dependencies:** `gray-matter`, `js-yaml`, `picocolors`, `@clack/prompts`, `gradient-string`. Keep it minimal.
- **Atomic writes required** for `session.json` and turn files — use `atomicWrite()` from `src/util.ts`.
- **Frontmatter security:** never use `matter.stringify()`, always `yaml.dump()` to prevent injection.
- **Tests use `node:test`** built-in runner via `tsx --test`, no mocking frameworks. Test files are listed explicitly in package.json (no shell glob) for Windows compatibility.
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- **Never commit to `main`/`master`/`dev`/`stage`** — use feature branches.
- **No session resumption.** Sessions are not recoverable — each `def` invocation starts fresh.
- **All def sessions are equal.** There are no special sessions - the initial session that happens to launch the explorer is not special. All sessions are treated equally.

## Reference Documentation

The `references/` directory contains long-lived implementation guides written for implementing agents. Unlike `docs/` (which is gitignored for session artifacts), everything in `references/` is committed and versioned as persistent project knowledge.

When creating or updating references:
- Write from the perspective of an implementing agent tasked with extending or debugging features
- Ground content in the tracked main branch -- do not reference worktree artifacts or temporary session state
- Use concrete file paths, component names, and API endpoints from the actual codebase
- Cover setup, conventions, testing patterns, and gotchas specific to this repo
