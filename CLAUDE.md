# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](./AGENTS.md) for full architecture, conventions, and agent operating rules.

## Quick Reference

```sh
npm start -- --topic "Your topic"    # Run ACB
npm test                              # Run tests (node:test)
npm run dev:ui                        # Dev UI with hot reload
npm run build:ui                      # Build UI
```

Run a single test file: `node --test src/__tests__/validate.test.js`

## Key Constraints

- **Backend is plain JS (ESM), not TypeScript.** Node.js 20+, no framework.
- **Only two dependencies:** `gray-matter` and `js-yaml`. Keep it minimal.
- **Atomic writes required** for `session.json` and turn files — use `atomicWrite()` from `src/util.js`.
- **Frontmatter security:** never use `matter.stringify()`, always `yaml.dump()` to prevent injection.
- **Tests use `node:test`** built-in runner, no mocking frameworks.
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`.
- **Never commit to `main`/`master`/`dev`/`stage`** — use feature branches.
