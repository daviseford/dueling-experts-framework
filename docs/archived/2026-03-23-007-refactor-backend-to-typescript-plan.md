---
title: "refactor: Convert backend from plain JS to TypeScript"
type: refactor
status: active
date: 2026-03-23
---

# refactor: Convert backend from plain JS to TypeScript

## Overview

Convert the 9 backend source files (~2150 LOC) and 5 test files (~500 LOC) from plain ESM JavaScript to TypeScript. The frontend (`src/ui/`) is already TypeScript — this unifies the stack.

## Problem Statement / Motivation

The backend is plain JS with no type checking. Bugs like the missing `writeFile` import (silently swallowed by a catch) and the `r.action.type` vs `r.type` shape mismatch (would crash at runtime) were only caught by manual review. TypeScript would catch both at compile time.

## Proposed Solution

Use `tsc` with `--noEmit` for type checking only. Continue running via `tsx` or `ts-node/esm` (Node 20+ ESM). No build step — the runtime handles TS natively. This keeps the "zero build for backend" developer experience while adding type safety.

## Technical Approach

### Phase 1: Tooling setup

**Add devDependencies:**
- `typescript` (~5.x)
- `tsx` (for running .ts files directly, replaces `node src/index.js`)
- `@types/node` (Node.js built-in types)
- `@types/js-yaml` (js-yaml has bundled types but verify)

**Create `tsconfig.json`** at project root (backend only, UI has its own):
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/ui", "node_modules"]
}
```

**Update `package.json` scripts:**
```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "test": "tsx --test src/__tests__/*.test.ts",
    "typecheck": "tsc --noEmit",
    "dev:ui": "cd src/ui && npm run dev",
    "build:ui": "cd src/ui && npm run build"
  }
}
```

**Update `bin/def`:**
```
#!/usr/bin/env tsx
import '../src/index.js';  // tsx resolves .ts from .js imports
```
Or simpler: change to `#!/usr/bin/env node` with `--import tsx/esm` loader.

### Phase 2: Rename files (.js → .ts)

Rename all 9 source files and 5 test files. Do this in one commit so imports don't break mid-migration.

```
src/index.js         → src/index.ts
src/orchestrator.js  → src/orchestrator.ts
src/agent.js         → src/agent.ts
src/context.js       → src/context.ts
src/validation.js    → src/validation.ts
src/session.js       → src/session.ts
src/recovery.js      → src/recovery.ts
src/server.js        → src/server.ts
src/actions.js       → src/actions.ts
src/util.js          → src/util.ts
src/__tests__/actions.test.js      → src/__tests__/actions.test.ts
src/__tests__/context.test.js      → src/__tests__/context.test.ts
src/__tests__/normalizeStatus.test.js → src/__tests__/normalizeStatus.test.ts
src/__tests__/util.test.js         → src/__tests__/util.test.ts
src/__tests__/validate.test.js     → src/__tests__/validate.test.ts
```

Update all import paths from `'./foo.js'` to `'./foo.js'` (NodeNext resolution keeps `.js` extensions even for `.ts` files — this is the correct ESM + TS pattern).

### Phase 3: Add types file by file

Work through each file, adding types. Order by dependency (leaves first):

1. **`src/util.ts`** (30 LOC, no deps) — trivial, just add param/return types
2. **`src/validation.ts`** (124 LOC) — define `TurnData` and `ValidationResult` interfaces
3. **`src/session.ts`** (161 LOC) — define `Session` interface (the core type used everywhere)
4. **`src/agent.ts`** (149 LOC) — define `AgentConfig`, `InvokeResult` types
5. **`src/actions.ts`** (244 LOC) — define `Action`, `ActionResult` types
6. **`src/context.ts`** (262 LOC) — mostly string building, light typing
7. **`src/orchestrator.ts`** (531 LOC) — largest file, uses types from all above
8. **`src/server.ts`** (336 LOC) — HTTP types from Node, uses `Session`
9. **`src/recovery.ts`** (162 LOC) — uses `Session`, straightforward
10. **`src/index.ts`** (154 LOC) — CLI arg parsing, session creation

### Phase 4: Type the tests

- Add types to test files (mostly just import types for test data construction)
- Verify `tsx --test` runs all tests correctly
- Run `tsc --noEmit` and fix any remaining errors

### Phase 5: Cleanup

- Update `CLAUDE.md` and `AGENTS.md`: change "Backend is plain JS (ESM)" to "Backend is TypeScript (ESM)"
- Update `AGENTS.md` file listing (`.ts` extensions)
- Add `typecheck` to any CI if it exists
- Remove the gray-matter `@types` package if not needed (it has bundled types)

## Key Types to Define

```typescript
// src/types.ts or inline in each module

interface Session {
  id: string;
  topic: string;
  mode: 'planning';
  max_turns: number;
  target_repo: string;
  created: string;
  session_status: 'active' | 'paused' | 'completed' | 'interrupted';
  current_turn: number;
  next_agent: AgentName;
  phase: 'debate' | 'implement' | 'review';
  impl_model: AgentName;
  review_turns: number;
  port: number | null;
  dir: string;
  lockPath?: string;
  _currentChild?: ChildProcess | null;
}

type AgentName = 'claude' | 'codex';
type TurnStatus = 'complete' | 'needs_human' | 'done' | 'decided' | 'error';

interface TurnData {
  id: string;
  turn: number;
  from: string;
  timestamp: string;
  status: TurnStatus;
  decisions?: string[];
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  data: TurnData | null;
  content: string;
}

interface Action {
  type: 'write-file' | 'edit-file' | 'shell' | 'mkdir';
  path?: string;
  cmd?: string;
  cwd?: string;
  search?: string;
  body?: string;
}

interface ActionResult {
  action: Action;
  ok: boolean;
  error?: string;
  output?: string;
}
```

## Decisions

- **No build step**: Use `tsx` for direct execution. Avoids a `dist/` directory and keeps the dev loop fast.
- **`noEmit` only**: `tsc` is used only for type checking, not compilation. This means no source maps complexity.
- **Keep `.js` import extensions**: NodeNext module resolution requires `.js` extensions in imports even when source files are `.ts`. This is the correct ESM convention.
- **Types inline, not a separate `types.ts`**: Each module defines its own types. Shared types (like `Session`) are exported from `session.ts` and imported where needed. This avoids a "god types file" anti-pattern.
- **`gray-matter` typing**: The `gray-matter` package has incomplete types. May need a local `.d.ts` shim or `// @ts-expect-error` for the `engines` option.

## Acceptance Criteria

- [ ] All 9 source files and 5 test files converted to `.ts`
- [ ] `tsx src/index.ts --topic "test"` starts a session successfully
- [ ] `tsx --test src/__tests__/*.test.ts` — all tests pass
- [ ] `tsc --noEmit` — zero errors
- [ ] `bin/def --topic "test"` works end-to-end
- [ ] No new runtime dependencies (only devDependencies added)
- [ ] `CLAUDE.md` and `AGENTS.md` updated

## Dependencies & Risks

- **`gray-matter` types**: May need a declaration file. The `engines` config option used for security (disabling JS/Coffee engines) might not be in the type definitions.
- **`tsx` + `node:test`**: Verify `tsx --test` works with Node's built-in test runner. If not, fall back to `node --import tsx/esm --test`.
- **`bin/def` shebang**: The `#!/usr/bin/env tsx` shebang may not work on all systems. Alternative: keep `#!/usr/bin/env node` and use `--import tsx/esm` via `NODE_OPTIONS`.

## Sources & References

- Existing UI TypeScript config: `src/ui/tsconfig.json`
- UI types already define `Turn`, `TurnsResponse`, `SessionPhase`: `src/ui/src/lib/types.ts`
- tsx documentation: https://tsx.is
