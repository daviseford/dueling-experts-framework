---
title: "feat: Rebuild watcher UI with shadcn/ui"
type: feat
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-shadcn-ui-rebuild-requirements.md
---

# feat: Rebuild watcher UI with shadcn/ui

## Overview

Replace the single-file vanilla HTML/CSS/JS watcher UI (`src/ui/index.html`, 408 lines) with a Vite + React + TypeScript + Tailwind CSS v4 + shadcn/ui application. The rebuild achieves feature parity with the current UI while delivering polished, accessible components and a modern frontend foundation for future work (see origin: `docs/brainstorms/2026-03-23-shadcn-ui-rebuild-requirements.md`).

## Problem Statement / Motivation

The current watcher UI is a monolithic HTML file with inline CSS and vanilla JS. It works but is difficult to extend, has no component structure, and looks rough compared to what shadcn/ui provides out of the box. The user wants both visual polish and extensibility for future UI features (see origin: brainstorm key decisions).

## Proposed Solution

Full rebuild of the watcher UI as a React SPA served from the existing `node:http` server. The frontend lives in `src/ui/` with its own `package.json` and Vite build pipeline. In production, `server.js` serves the built `dist/` assets. In development, Vite's dev server proxies API requests to the running ACB server.

## Technical Approach

### Architecture

```
src/
  server.js              # Modified: serves dist/ assets + API endpoints
  ui/
    package.json         # New: React, Vite, Tailwind, shadcn deps
    vite.config.ts       # New: Vite config with proxy + Tailwind plugin
    tsconfig.json        # New: TypeScript config with path aliases
    tsconfig.app.json    # New: App-specific TS config
    components.json      # New: shadcn/ui CLI config
    index.html           # New: Vite entrypoint (replaces current index.html)
    src/
      main.tsx           # React entry point
      App.tsx            # Root component: layout + polling logic
      index.css          # Tailwind imports + shadcn theme variables
      lib/
        utils.ts         # cn() helper (shadcn standard)
        api.ts           # Typed API client (fetch wrappers)
        types.ts         # TypeScript types for API responses
      hooks/
        use-polling.ts   # Polling logic extracted as a hook
      components/
        ui/              # shadcn/ui components (Button, Card, Badge, etc.)
        transcript.tsx   # Turn list with auto-scroll
        turn-card.tsx    # Individual turn display (color-coded)
        thinking-indicator.tsx  # Animated thinking state
        interjection-input.tsx  # Textarea + Send button
        session-header.tsx      # Title, topic, End Session button
        pause-banner.tsx        # Yellow warning banner
        status-bar.tsx          # Connection status + turn counter
    dist/                # Build output (gitignored)
```

### Component-to-shadcn Mapping

| UI Element | shadcn/ui Component | Notes |
|---|---|---|
| Turn cards | `Card`, `CardHeader`, `CardContent` | Color-coded via CSS variables per agent |
| Header buttons | `Button` (variant: `destructive` for End Session) | |
| Send button | `Button` (variant: `default`, green) | |
| Interjection textarea | `Textarea` | |
| Pause banner | `Alert` (variant: `warning`) | |
| Status badges | `Badge` | For agent labels (CLAUDE, CODEX, DAVIS, SYSTEM) |
| Transcript area | `ScrollArea` | Handles auto-scroll |
| Error feedback | `Sonner` (toast) | Replaces `alert()` calls |
| Thinking indicator | Custom component | Animated dots with elapsed time |
| Confirm dialog | `AlertDialog` | For End Session confirmation |

### API Types (`src/ui/src/lib/types.ts`)

```typescript
interface Turn {
  id: string;
  turn: number;
  from: 'claude' | 'codex' | 'human' | 'system';
  timestamp: string;
  status: 'complete' | 'needs_human' | 'done' | 'error';
  decisions: string[];
  content: string;
}

interface ThinkingState {
  agent: 'claude' | 'codex';
  since: string;
}

interface TurnsResponse {
  turns: Turn[];
  session_status: 'active' | 'paused' | 'completed';
  topic: string;
  turn_count: number;
  thinking: ThinkingState | null;
}
```

### Server Changes (`src/server.js`)

The `serveUI()` function is replaced with a static directory server. No new dependencies — hand-written with a MIME type map (~30 lines), matching the project's zero-framework philosophy.

Key changes:
1. **MIME type lookup table** for `.html`, `.js`, `.css`, `.svg`, `.json`, `.woff2`, `.map`, etc.
2. **Static file resolver**: reads from `join(__dirname, 'ui', 'dist')`, with directory traversal protection via `normalize(resolve(...))` check
3. **Cache headers**: `Cache-Control: public, max-age=31536000, immutable` for `/assets/*` (Vite's hashed chunks), `no-cache` for `index.html`
4. **SPA fallback**: non-API GET requests that don't match a file serve `index.html`
5. **Security headers preserved**: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` on all responses

Route priority (unchanged for API, extended for static):
1. Security middleware (Host/Origin validation, CORS)
2. `GET /api/turns` → existing handler
3. `POST /api/interject` → existing handler
4. `POST /api/end-session` → existing handler
5. `GET /*` → static file from `dist/` → SPA fallback to `index.html`
6. `*` → 404

### Dark Theme

Use Approach A from shadcn/ui docs: `class="dark"` on `<html>` in `index.html`. Include both `:root` and `.dark` CSS variable blocks so all `dark:` Tailwind variants work correctly. No ThemeProvider component needed — dark-only, no toggle. The `neutral` base color provides a GitHub-inspired dark palette similar to the current UI.

### Vite Dev Server Proxy

```typescript
// src/ui/vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.ACB_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
})
```

Developer must start a real ACB session (`acb --topic "test"`) and pass the port via `ACB_PORT=<port> npm run dev:ui`. The port is printed to the console when the server starts and saved to `session.json`.

### Implementation Phases

#### Phase 1: Scaffold and Infrastructure

**Goal:** Vite project builds and the server can serve it.

Tasks:
- [ ] Create `src/ui/package.json` with React 19, Vite 6, TypeScript 5, Tailwind CSS v4, `@tailwindcss/vite`, `@vitejs/plugin-react`
- [ ] Create `src/ui/vite.config.ts` with React plugin, Tailwind plugin, path aliases, proxy config
- [ ] Create `src/ui/tsconfig.json` and `src/ui/tsconfig.app.json` with `@/` path alias
- [ ] Create `src/ui/index.html` with `class="dark"` on `<html>`, `<div id="root">`, module script entry
- [ ] Create `src/ui/src/index.css` with `@import "tailwindcss"`, shadcn CSS variables (dark theme), base layer styles
- [ ] Create `src/ui/src/main.tsx` — renders `<App />` into `#root`
- [ ] Create `src/ui/src/App.tsx` — minimal "Hello world" placeholder
- [ ] Create `src/ui/src/lib/utils.ts` — `cn()` helper using `clsx` + `tailwind-merge`
- [ ] Run `npx shadcn@latest init` inside `src/ui/` to generate `components.json` (style: new-york, rsc: false, baseColor: neutral)
- [ ] Modify `src/server.js`: replace `serveUI()` with static directory server for `src/ui/dist/`
- [ ] Add to root `package.json` scripts: `"dev:ui"`, `"build:ui"`
- [ ] Add `src/ui/dist/` and `src/ui/node_modules/` to `.gitignore`
- [ ] Run `npm run build:ui` and verify the server can serve the built app

**Success criteria:** `acb --topic "test"` opens the browser and shows the React placeholder app. `ACB_PORT=<port> npm run dev:ui` starts Vite with HMR.

#### Phase 2: Core Components

**Goal:** All UI components built with shadcn/ui, not yet wired to real data.

Tasks:
- [ ] Install shadcn/ui components: `button`, `card`, `badge`, `textarea`, `scroll-area`, `alert`, `alert-dialog`, `sonner`
- [ ] Create `src/ui/src/lib/types.ts` — `Turn`, `ThinkingState`, `TurnsResponse` interfaces
- [ ] Create `src/ui/src/lib/api.ts` — typed `fetchTurns()`, `sendInterjection(content)`, `endSession()` functions
- [ ] Create `src/ui/src/components/session-header.tsx` — title "ACB", topic span, End Session button (destructive variant) with AlertDialog confirmation
- [ ] Create `src/ui/src/components/pause-banner.tsx` — shadcn Alert with warning styling, conditionally visible
- [ ] Create `src/ui/src/components/turn-card.tsx` — Card with color-coded header by `from` field (claude=blue, codex=green, human=purple, system=yellow), error styling for `status=error` (red border/header), monospace content body
- [ ] Create `src/ui/src/components/thinking-indicator.tsx` — pulsing dots animation + elapsed time display, color-coded header matching agent
- [ ] Create `src/ui/src/components/transcript.tsx` — ScrollArea containing turn cards + thinking indicator, auto-scroll on new content
- [ ] Create `src/ui/src/components/interjection-input.tsx` — Textarea + Send button, Enter to send / Shift+Enter for newline / IME-aware, double-send guard, toast on error (replaces `alert()`)
- [ ] Create `src/ui/src/components/status-bar.tsx` — connection status text + turn counter

**Agent label mapping:** `{ claude: 'CLAUDE', codex: 'CODEX', human: 'DAVIS', system: 'SYSTEM' }` — hardcoded for parity. Add `// TODO: make configurable` comment.

**Success criteria:** Each component renders correctly with mock/static props. Visual quality is noticeably better than the vanilla UI.

#### Phase 3: Polling and State Integration

**Goal:** Wire components to real API data with polling.

Tasks:
- [ ] Create `src/ui/src/hooks/use-polling.ts` — custom hook encapsulating:
  - 3-second `setTimeout` polling (not `setInterval`)
  - Flight guard preventing overlapping fetches
  - Stale response detection (turn count comparison)
  - Incremental thinking indicator updates (elapsed time) without full re-render
  - Stop polling on session completed
  - Graceful error handling (show in status bar, continue polling)
  - Suppress connection errors after session completion (5-second shutdown race)
- [ ] Wire `App.tsx` as the orchestrating component:
  - Calls `usePolling()` to get turns, session status, topic, thinking state
  - Passes data down to child components as props
  - Manages `disabled` state for controls when session is completed
- [ ] Wire `interjection-input.tsx` to `api.sendInterjection()` with loading state
- [ ] Wire `session-header.tsx` End Session button to `api.endSession()` with loading state
- [ ] Verify auto-scroll behavior: always scroll to bottom on new turns or thinking update
- [ ] Verify pause banner shows/hides based on `session_status === 'paused'`
- [ ] End-to-end test: start a real ACB session and verify the rebuilt UI works identically

**Success criteria:** All R2 sub-requirements (R2a through R2i) verified working against a real session.

#### Phase 4: Cleanup

**Goal:** Remove old UI, finalize build workflow.

Tasks:
- [ ] Delete the old `src/ui/index.html` (the vanilla version — now replaced by the Vite project)
- [ ] Verify `npm run build:ui && acb --topic "test"` works end-to-end
- [ ] Verify `ACB_PORT=<port> npm run dev:ui` works with HMR
- [ ] Add `prepare` script to root `package.json`: `"prepare": "cd src/ui && npm install && npm run build"` so `npm install` at the root produces a working build
- [ ] Update any documentation referencing the old UI

**Success criteria:** Clean repo with no remnants of the vanilla UI. Fresh clone → `npm install` → `acb --topic "test"` works.

## System-Wide Impact

- **Server changes**: `serveUI()` in `server.js` is replaced with a static directory server. All existing security middleware (Host/Origin validation, CORS, CSRF) is preserved. API routes are unaffected.
- **Dependencies**: Root `package.json` gains zero new dependencies. All frontend deps live in `src/ui/package.json` as a separate install context.
- **Build step**: The project gains its first build step. The `prepare` script ensures it runs automatically after `npm install`.
- **Binary distribution**: Anyone running `acb` from a git clone must run `npm install` (which triggers `prepare` → builds UI). This is standard behavior.

## Acceptance Criteria

### Functional Requirements
- [ ] All existing watcher features work identically (R2a-R2i)
- [ ] UI uses shadcn/ui components (Card, Button, Badge, Textarea, ScrollArea, Alert, AlertDialog, Sonner)
- [ ] Dark theme by default, visually polished (R3)
- [ ] Color-coded turn cards: Claude=blue, Codex=green, Human=purple, System=yellow, Error=red
- [ ] Thinking indicator with animated dots and elapsed time
- [ ] Interjection: Enter to send, Shift+Enter for newline, IME-aware, toast on error
- [ ] End Session with confirmation dialog
- [ ] Pause banner when session is paused
- [ ] Auto-scroll to bottom on new content
- [ ] 3-second polling with flight guard and stale response detection
- [ ] Controls disabled when session completes; polling stops
- [ ] Graceful handling of post-completion server shutdown (suppress connection errors)

### Build & Dev Workflow
- [ ] `npm run build:ui` produces static assets in `src/ui/dist/`
- [ ] `npm run dev:ui` starts Vite dev server with API proxy
- [ ] `acb --topic "test"` serves the built React app
- [ ] Fresh clone → `npm install` → `acb` works (via `prepare` script)

### Non-Functional Requirements
- [ ] No new dependencies in root `package.json`
- [ ] Security headers preserved on all static file responses
- [ ] Directory traversal protection in static file serving
- [ ] Cache-Control: immutable for hashed assets, no-cache for index.html

## Dependencies & Risks

**Dependencies:**
- Vite 6, React 19, TypeScript 5, Tailwind CSS v4, shadcn/ui (latest) — all stable, well-documented
- `@tailwindcss/vite` plugin (replaces PostCSS approach from Tailwind v3)

**Risks:**
- **Random server port complicates dev proxy**: Mitigated by `ACB_PORT` env var. The port is logged to console and saved in `session.json`.
- **Static file serving correctness**: Hand-written MIME map must cover all Vite output types. Mitigated by testing with a real build.
- **5-second shutdown race**: After session completes, the server stops 5 seconds later. The polling hook must suppress fetch errors after seeing `completed` status.

## Key Decisions Carried Forward from Origin

- Full rebuild in one pass (not incremental migration) — ~400 lines is manageable
- TypeScript for frontend only; backend stays JavaScript
- shadcn/ui copy-paste model (components live in repo)
- Vite as build tool (standard for React, fast HMR)
- No SSR, no state management library, no UI unit tests in first pass
- No new features — strict feature parity
- No changes to the backend API contract

## Sources & References

### Origin
- **Origin document:** [docs/brainstorms/2026-03-23-shadcn-ui-rebuild-requirements.md](docs/brainstorms/2026-03-23-shadcn-ui-rebuild-requirements.md) — Key decisions: full rebuild, TypeScript frontend, Vite build tool, shadcn copy-paste model

### Internal References
- Server static file serving: `src/server.js:123-132` (current `serveUI()` to be replaced)
- API endpoints: `src/server.js:103-121` (route definitions, unchanged)
- Controller pattern: `src/orchestrator.js:25-40` (shared with server)
- Current UI: `src/ui/index.html` (408 lines, to be replaced)
- Agent label map: `src/ui/index.html:191` (hardcoded DAVIS)

### External References
- [shadcn/ui Vite installation](https://ui.shadcn.com/docs/installation/vite)
- [Tailwind CSS v4 docs](https://tailwindcss.com/docs)
- [Vite server proxy options](https://vite.dev/config/server-options)
