---
date: 2026-03-23
topic: shadcn-ui-rebuild
---

# Rebuild Watcher UI with shadcn/ui

## Problem Frame
The ACB watcher UI is a single vanilla HTML/CSS/JS file (~400 lines) with inline styles, no component structure, and no build tooling. It works but looks rough and is difficult to extend with new features. Adopting shadcn/ui gives polished, accessible components out of the box and a modern React foundation for future UI work.

## Requirements
- R1. Replace the current `src/ui/index.html` with a Vite + React + TypeScript application using Tailwind CSS and shadcn/ui components
- R2. Reproduce all existing watcher UI functionality:
  - R2a. Real-time transcript display with color-coded turn cards (Claude=blue, Codex=green, Human=purple, System=yellow)
  - R2b. Thinking indicator with animated dots and elapsed time
  - R2c. Human interjection textarea with Send button (Enter to send, Shift+Enter for newline)
  - R2d. Session header with topic display and End Session button
  - R2e. Pause banner when agent needs human input
  - R2f. Status bar with connection status and turn counter
  - R2g. Auto-scroll to bottom on new content
  - R2h. 3-second polling for updates
  - R2i. Disable controls when session is completed
- R3. Dark theme by default, consistent with the current GitHub-inspired dark aesthetic
- R4. The existing Node.js server (`src/server.js`) serves the built frontend assets in production
- R5. Development workflow uses Vite dev server with proxy to the API server
- R6. The `ui/` directory lives under `src/` (e.g., `src/ui/`) and builds to a `dist/` output that the server can serve statically

## Success Criteria
- All existing watcher features work identically after the rebuild
- The UI uses shadcn/ui components (Card, Button, Badge, Textarea, ScrollArea, Alert, etc.) rather than custom-styled HTML
- `npm run dev:ui` (or similar) starts the Vite dev server for frontend development
- `npm run build:ui` produces static assets the Node.js server can serve
- The UI is visually polished — noticeably better than the current vanilla version

## Scope Boundaries
- No new features beyond what currently exists (feature parity only)
- No changes to the backend API contract (`/api/turns`, `/api/interject`, `/api/end-session`)
- No SSR or server-side rendering — this remains a client-side SPA
- No state management library (Zustand, Redux, etc.) — React state + hooks are sufficient for this scope
- No unit tests for UI components in this pass (can be added later)

## Key Decisions
- **Vite as build tool**: Standard choice for React apps, fast HMR, simple config
- **TypeScript for frontend only**: shadcn/ui is designed for TS; the backend remains JS
- **Full rebuild in one pass**: At ~400 lines, incremental migration adds complexity without benefit
- **shadcn/ui components**: Use the copy-paste model (components live in the repo), giving full control over customization

## Deferred to Planning
- [Affects R1][Technical] Exact Vite config and proxy setup for development
- [Affects R4][Technical] How `server.js` discovers and serves the built assets (static file middleware vs. path configuration)
- [Affects R6][Technical] Directory structure for React components and shadcn/ui setup
- [Affects R2][Needs research] Which specific shadcn/ui components map best to each UI element

## Next Steps
→ `/ce:plan` for structured implementation planning
