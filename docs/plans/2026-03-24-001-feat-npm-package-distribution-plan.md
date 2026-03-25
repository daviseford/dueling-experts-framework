---
title: "feat: Publish as npm package @daviseford/def"
type: feat
status: active
date: 2026-03-24
origin: docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md
---

# feat: Publish as npm package @daviseford/def

## Overview

Make DEF installable via `npm install -g @daviseford/def` and runnable via `npx @daviseford/def "topic"` on macOS, Windows, and Linux. The published package ships compiled JavaScript and pre-built UI assets — no tsx, Vite, or React devDependencies needed on user machines.

The developer (daviseford) keeps their local install up to date with `npm install -g --force .` from the repo root, which links `bin/def` globally. This dev workflow must remain unbroken.

## Current State (feat/npm-package-distribution branch)

### Already Done

| Phase | Status | Notes |
|-------|--------|-------|
| **tsconfig.build.json** | Done | Extends tsconfig.json, `outDir: dist`, excludes tests + UI |
| **`npm run build` script** | Done | Cleans dist/ then runs `tsc -p tsconfig.build.json` — compiles cleanly |
| **`npm run typecheck`** | Done | Still works (unchanged) |
| **`npm test`** | Done | Still works (unchanged) |
| **bin/def dual-mode** | Done | Detects `src/index.ts` → dev mode (tsx + UI staleness check); else → compiled dist. Uses `pathToFileURL` for Windows compat |
| **`--version` / `-v` flag** | Done | `src/cli.ts` + `src/index.ts` — reads version from package.json |
| **package.json overhaul** | Done | name `@daviseford/def`, description, keywords, repository, author, license, engines, files, publishConfig, build/prepublishOnly scripts, prepare → dev-setup.js |
| **scripts/copy-ui-dist.js** | Done | Copies `src/ui/dist/` → `dist/ui/dist/` for tarball |
| **scripts/dev-setup.js** | Done | Runs UI install+build only in git checkout (`.git/` check) |
| **.gitignore** | Done | Added `dist/`, `*.tgz` |
| **LICENSE** | Done | MIT |
| **npm login** | Done | Logged in as `daviseford` |
| **Local dev test** | Done | `npm install -g --force .` works, `def --version` prints `1.0.0` |

### Remaining Work

| Phase | Status | What's needed |
|-------|--------|---------------|
| **README update** | Not started | Lead with `npm install -g`, move clone instructions to Development section, add `--version` to options, update "draft PR" → "PR" |
| **release-please config** | Not started | Verify `.github/release-please-config.json` works with new package name |
| **End-to-end tarball test** | Not started | `npm pack` → install from tarball → verify `def "hello"` with watcher UI |
| **npm publish** | Not started | `npm publish --access public` (first time) |
| **CI: pack dry-run** | Optional | Add `npm run build && npm pack --dry-run` to CI to catch tarball issues |

## Implementation Plan (Remaining Phases)

### Phase 1: README Update

**File:** `README.md`

1. Replace the Installation section to lead with npm install:
   ```
   npm install -g @daviseford/def
   ```
2. Add `npx @daviseford/def "your topic"` as alternative
3. Move clone-based install instructions to a **Development** section at the bottom with `npm start`, `npm test`, `npm run typecheck`, `npm run build` commands
4. Add `--version, -v` to the options table
5. Change "draft PR" references to "PR"

### Phase 2: Release Config Check

**File:** `.github/release-please-config.json`

The config uses `"."` as the package path and reads version from `package.json`. The package name change should be transparent to release-please. Verify — no change likely needed.

### Phase 3: End-to-End Verification

1. `npm run build && npm run build:ui && node scripts/copy-ui-dist.js`
2. `npm pack --dry-run` — verify no TS source, tests, or docs
3. `npm pack` — create tarball
4. `npm install -g ./daviseford-def-1.0.0.tgz` — test from tarball
5. `def --version` → `1.0.0`
6. `def "test topic"` → session starts with watcher UI (not headless fallback)
7. Clean up: `npm uninstall -g @daviseford/def && npm install -g --force .`

### Phase 4: First Publish

```bash
npm publish --access public
```

Post-publish verification:
- `npx @daviseford/def --version`
- Check https://www.npmjs.com/package/@daviseford/def

## Technical Notes

### bin/def Dual-Mode Detection

```
if dist/index.js exists AND src/index.ts does NOT exist → published mode (compiled JS)
else → dev mode (tsx + UI staleness check)
```

When installed from npm, `src/` is not in the tarball, so `src/index.ts` won't exist. When running from a git clone, `src/index.ts` exists and triggers dev mode even if `dist/` was built locally.

### Dev Workflow: `npm install -g --force .`

Creates a global symlink to `bin/def` in the local repo. `--force` overwrites any existing `def` binary. The `prepare` script detects `.git/` and runs UI setup only in dev checkouts.

### New Runtime Dependencies

The branch added `@clack/prompts`, `gradient-string`, and `picocolors` as production dependencies (CLI output styling). These will ship in the published package.

## User Setup: Publish Checklist

### Each Release

```bash
git checkout main && git pull
npm version patch   # or minor/major — creates tag + commit
npm publish          # prepublishOnly handles build automatically
git push && git push --tags
```

### Restore Dev After Testing Tarball

```bash
npm uninstall -g @daviseford/def
npm install -g --force .
```

## Acceptance Criteria

- [x] `npm run build` compiles TS to `dist/` cleanly
- [x] `npm run typecheck` still works
- [x] `npm test` still works
- [x] `def --version` prints version in both dev and compiled modes
- [x] `bin/def` works in dev mode (tsx + UI staleness check)
- [x] `bin/def` works in published mode (compiled JS)
- [x] `npm install -g --force .` works for local dev
- [ ] README leads with `npm install -g @daviseford/def`
- [ ] `npm pack --dry-run` shows only dist/, bin/, README, LICENSE
- [ ] `def "hello"` works from tarball install with working watcher UI
- [ ] `npm publish --access public` succeeds
- [ ] `npx @daviseford/def --version` works without prior install

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md](docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md) — Key decisions: compile to JS via tsc, pre-build UI, scoped package `@daviseford/def`, manual publish

### Internal References

- `bin/def` — dual-mode entrypoint
- `tsconfig.build.json` — build config
- `scripts/copy-ui-dist.js` — UI asset copy for tarball
- `scripts/dev-setup.js` — prepare script (dev-only)
- `src/server.ts:22` — `UI_DIST` path resolution
- `src/cli.ts` — `--version` flag
- `.github/release-please-config.json` — release config
