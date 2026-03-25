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
```

Run a single test file: `tsx --test src/__tests__/validate.test.ts`

## Key Constraints

- **Backend is TypeScript (ESM).** Node.js 20+, run via `tsx`, no build step. Type-check with `tsc --noEmit`.
- **Five runtime dependencies:** `gray-matter`, `js-yaml`, `picocolors`, `@clack/prompts`, `gradient-string`. Keep it minimal.
- **Atomic writes required** for `session.json` and turn files — use `atomicWrite()` from `src/util.ts`.
- **Frontmatter security:** never use `matter.stringify()`, always `yaml.dump()` to prevent injection.
- **Tests use `node:test`** built-in runner via `tsx --test`, no mocking frameworks. Test files are listed explicitly in package.json (no shell glob) for Windows compatibility.
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- **Never commit to `main`/`master`/`dev`/`stage`** — use feature branches.
- **No session resumption.** Sessions are not recoverable — each `def` invocation starts fresh.
