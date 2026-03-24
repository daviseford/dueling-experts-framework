---
date: 2026-03-24
topic: npm-package-distribution
---

# Publish DEF as an npm Package

## Problem Frame

DEF currently requires cloning the repo, running `npm install`, and manually adding `bin/` to PATH. This is high-friction and blocks adoption. Users should be able to install with a single command and run `def` from anywhere on macOS, Windows, or Linux.

## Requirements

- R1. **Global install works cross-platform.** `npm install -g @daviseford/def` installs the package and makes `def` available on PATH on macOS, Windows (PowerShell + cmd), and Ubuntu/Linux.
- R2. **npx one-shot works.** `npx @daviseford/def "topic"` runs DEF without permanent installation. The UI build must be included in the published tarball so npx doesn't need to compile anything.
- R3. **Compile TypeScript to JS before publish.** The published package ships compiled JavaScript in `dist/`. No tsx runtime dependency for end users. The bin entrypoint runs `dist/` directly via Node.js.
- R4. **Pre-build UI before publish.** The React watcher UI is pre-built and included in the published tarball (`src/ui/dist/`). Users never run Vite or install React devDeps.
- R5. **Package name is `@daviseford/def`.** Scoped under your npm username. Binary name remains `def`.
- R6. **Publish workflow is scripted.** A manual `npm version` + `npm publish` flow with a `prepublishOnly` script that builds backend + UI. No CI/CD automation required.
- R7. **Minimal runtime dependencies.** Only `gray-matter` and `js-yaml` remain as production dependencies. `tsx`, `typescript`, Vite, React, etc. stay in devDependencies.
- R8. **README and package metadata are publish-ready.** `description`, `keywords`, `repository`, `license`, `engines`, and `files` fields are set in package.json. README already covers usage and prerequisites.

## Success Criteria

- A machine with Node.js 20+ and the required CLIs (claude, codex, gh) can run `npm install -g @daviseford/def && def "hello"` and get a working session
- `npx @daviseford/def "hello"` works without prior install
- The published tarball contains only compiled JS, built UI assets, and package metadata — no TypeScript source, no test files, no .claude/ or .def/ directories
- Works on macOS, Windows, and Ubuntu

## Scope Boundaries

- **Not changing the CLI interface.** All existing flags and behavior remain identical.
- **Not bundling into a single file.** Standard tsc compilation to dist/, not tsup/esbuild bundling. Keep it simple.
- **Not adding a CI/CD pipeline.** A manual `npm publish` workflow (with a build script) is sufficient for now. GitHub Actions can be added later.
- **Not renaming the binary.** It stays `def`.
- **Not adding auto-update or telemetry.**

## Key Decisions

- **Compile to JS (tsc):** Standard, debuggable output. tsx is removed from runtime. Users get faster startup and smaller install.
- **Pre-build UI:** The `prepare` script currently builds UI on install. For npm distribution, UI is built before publish and included in the tarball. `prepare` will be changed to only run in dev (or removed).
- **Scoped package name (`@daviseford/def`):** Guaranteed availability, clear ownership, and the binary name `def` is still short.
- **Support both npx and global install:** Both work naturally with compiled JS + bin field. No special handling needed beyond ensuring the package is self-contained.

## Dependencies / Assumptions

- You have an npm account with the `daviseford` scope
- The `def` binary name doesn't conflict with anything in npm's bin namespace (scoped packages avoid this)
- Node.js 20+ is the minimum supported version (already a prerequisite)

## Outstanding Questions

### Resolve Before Planning

(none)

### Deferred to Planning

- [Affects R3][Technical] Should tsc output to `dist/` with the same directory structure as `src/`, or should we flatten? Standard mirror (`dist/index.js`, `dist/orchestrator.js`, etc.) is simplest.
- [Affects R4][Technical] How should the server resolve the UI dist path at runtime — `__dirname` relative, or `import.meta.url`? Needs to work both in dev (tsx) and in the compiled package.
- [Affects R6][Technical] What's the simplest publish script? Likely: `npm run build && npm run build:ui && npm publish`. Could add a `prepublishOnly` script.
- [Affects R3][Needs research] Verify that all Node.js built-in imports (`node:fs`, `node:path`, etc.) work correctly with tsc's NodeNext module resolution in the compiled output.
- [Affects R8][Technical] Determine the right `files` array in package.json to include `dist/`, `src/ui/dist/`, `bin/`, `package.json`, `README.md`, and `LICENSE` while excluding everything else.

## Next Steps

→ `/ce:plan` for structured implementation planning
