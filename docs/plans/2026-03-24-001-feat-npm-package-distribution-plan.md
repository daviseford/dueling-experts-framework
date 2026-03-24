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

## Problem Statement / Motivation

The current install flow (clone repo → npm install → manually add bin/ to PATH) is high-friction and blocks adoption. A single `npm install -g` command is the standard distribution model for Node.js CLI tools and removes all manual PATH configuration. (see origin: docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md)

## Proposed Solution

Add a TypeScript build step (tsc), rewrite the bin entrypoint to run compiled JS, pre-build the UI before publish, and configure package.json for npm distribution. Manual publish via `npm version` + `npm publish`.

## Technical Considerations

### Build Strategy
- Create `tsconfig.build.json` extending the existing config with `noEmit: false` and `outDir: "dist"`. Keep the existing `tsconfig.json` (`noEmit: true`) for dev-time type checking — dev workflow unchanged.
- All imports already use `.js` extensions (correct for NodeNext), so tsc output resolves correctly without any import rewriting.
- `gray-matter`'s `engines` option typing may be incomplete — may need a type assertion during compilation.

### UI Path Resolution
- `server.ts` resolves UI dist as `resolve(__dirname, 'ui', 'dist')`. When compiled to `dist/server.js`, `__dirname` is `<pkg>/dist/`, so this would look for `dist/ui/dist/` which doesn't exist.
- **Fix:** Copy `src/ui/dist/` into `dist/ui/dist/` during the build. This preserves the existing path math in server.ts without code changes, and keeps dev and production behavior identical.

### bin/def Entrypoint
- Current entrypoint imports `tsx/esm` then loads `src/index.ts` — completely non-functional without tsx.
- **Fix:** Rewrite `bin/def` to import `../dist/index.js` directly. Remove the UI staleness check (irrelevant for published packages; UI is pre-built).
- Dev workflow uses `npm start` (tsx) as before — bin/def is only for the installed CLI command.

### Tarball Contents
- Without a `files` field, npm publishes everything not in `.gitignore` — including docs, tests, CI configs, UI source — but **excludes** `src/ui/dist/` (because it's gitignored). This is exactly backwards.
- **Fix:** Add `"files"` array to package.json to whitelist exactly what ships.

### Cross-Platform
- `bin/def` uses `#!/usr/bin/env node` shebang — works on macOS/Linux. On Windows, npm creates `.cmd` shims automatically.
- The copy step in `prepublishOnly` needs to work cross-platform. Use `node -e` or a simple script instead of `cp -r`.

## System-Wide Impact

- **Dev workflow:** Unchanged. `npm start` still uses tsx. `npm test` and `npm run typecheck` unchanged. The only new command is `npm run build`.
- **CI:** Should add a `npm pack --dry-run` step to catch tarball issues. Existing test/typecheck jobs unaffected.
- **release-please:** Already configured. Package name change in package.json and `.release-please-manifest.json` needed. No publish automation added (manual publish per scope decision).

## Acceptance Criteria

- [ ] `npm install -g @daviseford/def && def --version` works on a machine with Node.js 20+
- [ ] `npx @daviseford/def --help` works without prior install
- [ ] `def "hello"` starts a session with working watcher UI (not headless fallback)
- [ ] `npm pack --dry-run` shows only: `dist/`, `bin/`, `README.md`, `LICENSE` — no TS source, tests, docs, or CI configs
- [ ] Published tarball is under 2MB (compiled JS + UI assets + two small deps)
- [ ] `def --version` prints the package version
- [ ] `npm run typecheck` still works (dev workflow unchanged)
- [ ] `npm test` still works (dev workflow unchanged)
- [ ] `npm start -- --topic "test"` still works via tsx (dev workflow unchanged)

## Success Metrics

- A user can go from zero to running `def "topic"` with a single `npm install -g` command
- Package installs in under 30 seconds on a typical connection

## Dependencies & Risks

- **npm account:** You need an npm account with the `daviseford` scope and `npm login` configured
- **Scoped package access:** First publish of a scoped package must use `--access public` (or set `publishConfig` in package.json)
- **gray-matter typing:** The `engines: { evaluate: () => '' }` security option may produce type errors during tsc compilation — may need a type assertion
- **release-please manifest:** Needs updating after the package name change

## Implementation Plan

### Phase 1: Build Infrastructure

**Files:** `tsconfig.build.json` (new), `package.json`, `.gitignore`

1. Create `tsconfig.build.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "compilerOptions": {
       "noEmit": false,
       "outDir": "dist",
       "declaration": false
     }
   }
   ```

2. Add `dist/` to `.gitignore`

3. Add build script to `package.json`:
   ```json
   "build": "tsc -p tsconfig.build.json"
   ```

4. Run `npm run build` and verify output in `dist/` — all `.ts` files in `src/` should compile to `.js` in `dist/` with the same directory structure. Fix any type errors (likely `gray-matter` engines option).

### Phase 2: Rewrite bin/def

**Files:** `bin/def`

Replace the current entrypoint with a thin wrapper that imports compiled JS:

```javascript
#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
await import(resolve(__dirname, '..', 'dist', 'index.js'));
```

This removes:
- The tsx/esm import (line 51)
- The UI staleness check (lines 17-46)
- The raw `.ts` import (line 53)

Dev workflow: `npm start` still uses `tsx src/index.ts` directly — unaffected.

### Phase 3: Add --version Support

**Files:** `src/cli.ts`

Add `--version` flag handling to the CLI parser. Read version from `package.json` using `createRequire(import.meta.url)` or by reading and parsing the file. Print version and exit.

### Phase 4: Package.json Overhaul

**Files:** `package.json`

Update these fields:

```json
{
  "name": "@daviseford/def",
  "version": "1.0.0",
  "description": "CLI that orchestrates turn-based debates between Claude Code and Codex, then implements and reviews changes",
  "keywords": ["cli", "ai", "claude", "codex", "debate", "code-review"],
  "repository": {
    "type": "git",
    "url": "https://github.com/daviseford/claude-codex-chat.git"
  },
  "author": "daviseford",
  "license": "MIT",
  "engines": {
    "node": ">=20"
  },
  "files": [
    "dist/",
    "bin/",
    "README.md",
    "LICENSE"
  ],
  "publishConfig": {
    "access": "public"
  }
}
```

Key changes:
- `name`: `dueling-experts-framework` → `@daviseford/def`
- `files`: Whitelist only compiled output, bin, README, LICENSE. Note: `dist/ui/dist/` is inside `dist/` so it's covered.
- `prepare` script: **Replace** with a dev-only setup. Change to `"prepare": "node scripts/dev-setup.js"` which detects a local clone (checks for `.git/`) and runs `cd src/ui && npm install && npm run build` only in that case. On npm install from registry, `.git/` doesn't exist, so it's a no-op.
  - `"build"`: `tsc -p tsconfig.build.json`
  - `"build:ui"`: stays as-is (`cd src/ui && npm run build`)
  - `"prebuild"`: `node -e "const fs=require('fs');fs.rmSync('dist',{recursive:true,force:true})"` — clean stale output before each build
  - `"prepublishOnly"`: `npm run build && npm run build:ui && node scripts/copy-ui-dist.js`
- `publishConfig`: `{ "access": "public" }` for scoped package

### Phase 5: Build Scripts

**Files:** `scripts/copy-ui-dist.js` (new), `scripts/dev-setup.js` (new)

**copy-ui-dist.js** — Cross-platform script that copies `src/ui/dist/` to `dist/ui/dist/`:

```javascript
import { cpSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const src = resolve(root, 'src', 'ui', 'dist');
const dest = resolve(root, 'dist', 'ui', 'dist');
mkdirSync(dirname(dest), { recursive: true });
cpSync(src, dest, { recursive: true });
```

**dev-setup.js** — Runs UI install + build only in a local dev clone (not when installed from npm):

```javascript
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
// Only run in a git checkout (not when installed from npm registry)
if (!existsSync(resolve(root, '.git'))) process.exit(0);
console.log('[def] Dev setup: installing UI dependencies and building...');
execSync('npm install', { cwd: resolve(root, 'src', 'ui'), stdio: 'inherit' });
execSync('npm run build', { cwd: resolve(root, 'src', 'ui'), stdio: 'inherit' });
```

### Phase 6: Add LICENSE File

**Files:** `LICENSE` (new)

Create an MIT LICENSE file in the project root. The README and package.json already reference MIT but no LICENSE file exists.

### Phase 7: Update README

**Files:** `README.md`

Update the Installation section to lead with npm:

```markdown
## Installation

npm install -g @daviseford/def

Or run without installing:

npx @daviseford/def "your topic"
```

Move the clone-based install instructions to a "Development" section at the bottom.

### Phase 8: Update Release Config

**Files:** `.release-please-manifest.json`

Update the manifest to reflect the new package name. No automated npm publish — the workflow stays as-is per scope decision (see origin: docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md, Scope Boundaries).

### Phase 9: Verify and Publish

Manual verification steps:

1. `npm run build` — verify `dist/` contains compiled JS
2. `npm run build:ui` — verify `src/ui/dist/` has built assets
3. `node scripts/copy-ui-dist.js` — verify `dist/ui/dist/` exists
4. `npm pack --dry-run` — verify tarball contents (no TS source, tests, docs)
5. `npm pack` — create the tarball
6. Install from tarball locally: `npm install -g ./daviseford-def-1.0.0.tgz`
7. Run `def --version` — should print version
8. Run `def "test topic"` — should start session with working UI
9. `npm publish` — publish to npm

## Alternative Approaches Considered

- **Ship TS + tsx runtime:** Rejected — adds ~15MB install weight and slower cold start (see origin: Key Decisions)
- **Bundled single file (tsup/esbuild):** Rejected — adds build complexity beyond what's needed. Standard tsc is simpler and produces debuggable output (see origin: Scope Boundaries)
- **Automated CI publish:** Deferred — manual publish is sufficient for now. Can add GitHub Actions `npm publish` job later when release cadence increases

## Sources & References

### Origin

- **Origin document:** [docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md](docs/brainstorms/2026-03-24-npm-package-distribution-requirements.md) — Key decisions carried forward: compile to JS via tsc, pre-build UI, scoped package name `@daviseford/def`, manual publish workflow

### Internal References

- `bin/def` — current entrypoint (lines 51-53: tsx import + .ts import)
- `src/server.ts:21` — `UI_DIST` path resolution that breaks after compilation
- `src/cli.ts` — CLI argument parser (needs --version)
- `tsconfig.json` — current type-check-only config (`noEmit: true`)
- `.github/release-please-config.json` — release-please configuration
- `.release-please-manifest.json` — version manifest

### External References

- [npm package.json `files` field](https://docs.npmjs.com/cli/v10/configuring-npm/package-json#files)
- [npm lifecycle scripts](https://docs.npmjs.com/cli/v10/using-npm/scripts#life-cycle-scripts)
