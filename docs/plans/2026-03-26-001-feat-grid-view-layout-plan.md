---
title: "feat: Add toggleable grid view for multi-session display"
type: feat
status: completed
date: 2026-03-26
origin: docs/brainstorms/2026-03-26-grid-view-requirements.md
---

# feat: Add toggleable grid view for multi-session display

## Overview

Add a toggleable grid view to the DEF watcher UI so users can observe up to 4 sessions simultaneously. Currently the UI shows one session at a time via tabs. The grid view displays 1–4 fully interactive session panels in a responsive CSS Grid layout, with a single-click toggle between grid and full-screen (single-session) modes.

## Problem Frame

When monitoring multiple concurrent DEF sessions, users must switch tabs to check on each one. A grid view lets users observe and interact with up to four sessions simultaneously without tab-switching. (see origin: `docs/brainstorms/2026-03-26-grid-view-requirements.md`)

## Requirements Trace

- R1. Toggle button switches between full-screen mode and grid mode
- R2. Grid mode displays up to 4 sessions in a responsive layout (1=full, 2=50/50, 3=2+1, 4=2×2)
- R3. Each grid panel is fully interactive — scrollable transcript, interjection input, thinking indicator, expand/collapse turns
- R4. Each grid panel has a dedicated maximize button
- R5. Tab bar and session selection continue to work in full-screen mode; grid mode shows all active sessions

## Scope Boundaries

- Maximum 4 sessions in grid — if >4 visible sessions exist, show the first 4 (by creation order)
- No drag-and-drop reordering of grid panels
- No resizable panel splits — layout is automatic based on session count
- No new backend API endpoints needed — the existing API is already multi-session-ready

## Context & Research

### Relevant Code and Patterns

- `src/ui/src/App.tsx` — Main layout. Lines 58–148 contain per-session state (pendingInterjections, openMap, phase tracking) that currently lives at the App level for a single session. Lines 176–198 contain the session content area (PauseBanner, Transcript, InterjectionInput) that needs extraction into a reusable component.
- `src/ui/src/hooks/use-explorer.ts` — `useLiveExplorer` manages both session-list polling (every 5s) and turn-data polling for the selected session (every 3s) in a single hook. These need to be separated so each grid panel can poll its own session's turns independently.
- `src/ui/src/hooks/use-mock-explorer.ts` — Mock data provider implementing `ExplorerState`. Needs updating to match the refactored hook interface and provide 4 mock sessions for grid testing.
- `src/ui/src/lib/types.ts` — `PollingState` interface already cleanly represents per-session turn data. `ExplorerState` extends it with session-list fields.
- `src/ui/src/lib/api.ts` — `fetchSessionTurns(sessionId)` and `sendInterjection(sessionId, content)` are already parameterized by session ID. No changes needed.
- `src/ui/src/components/session-tab-bar.tsx` — Auto-hides when ≤1 session. Returns null.
- All leaf components (`Transcript`, `TurnCard`, `InterjectionInput`, `PauseBanner`, `ThinkingIndicator`, `SessionSummary`, `PendingTurnCard`) are already fully self-contained via props — no refactoring needed. `StatusBar` needs a minor update: ThemeToggle moves to `SessionHeader`, leaving a compact per-panel variant.

### Institutional Learnings

- No `docs/solutions/` directory exists. Relevant context from existing plans:
  - Session explorer plan (`docs/plans/2026-03-25-002-feat-session-explorer-plan.md`) established that `openMap`, `pendingInterjections`, and `prevPhaseRef` must reset on session switch — in grid mode, these must be independently tracked per panel.
  - Pending interjection UI requirements documented the reconciliation logic (count-based matching, phase-drop detection) — this logic moves into `SessionPanel` unchanged.

## Key Technical Decisions

- **Extract `useSessionTurns` hook from `useLiveExplorer`**: The current hook manages both session-list polling and per-session turn polling in one monolith. For grid view, each panel needs independent turn polling. Splitting into `useSessionList` (session list) + `useSessionTurns` (per-session) is the cleanest decomposition.

- **Mock/live dispatch pattern**: Each exported hook (`useSessionList`, `useSessionTurns`) internally checks `isMock` and dispatches to its own mock or live implementation. Both implementations are called unconditionally per React hook rules (same pattern as the current `useExplorer`). This means `use-mock-explorer.ts` must export both `useMockSessionList` (returning `SessionListState` with 4 sessions) and `useMockSessionTurns` (returning `PollingState` keyed by sessionId).

- **`SessionListState` interface**: Returns `{ sessions, selectedSessionId, setSelectedSessionId, owningSessionId }`. Includes `owningSessionId` since it comes from the session-list API response (`SessionsResponse.owning_session_id`).

- **Elapsed timer lives inside `useSessionTurns`**: The 1-second interval that updates `thinkingElapsed` and `sessionTimer` moves into `useSessionTurns`. Each panel gets its own interval (up to 4 concurrent 1s intervals — acceptable for a local UI). The hook reads `session.created` from the `sessions` array passed as a parameter.

- **Turn polling stop logic**: `useSessionTurns` should stop its polling loop based on `session_status` from its own `TurnsResponse` (i.e., `data.session_status === 'completed' || 'interrupted'`), not from the `sessions` prop. The turns endpoint returns fresher status than the 5s session-list poll, eliminating a stale-data race.

- **`SessionPanel` component as the extraction boundary**: The per-session state variables (`pendingInterjections`, `openMap`, `prevPhaseRef`, interjection reconciliation, phase-drop detection) and per-session JSX (`PauseBanner`, `Transcript`, `InterjectionInput`) move from `App.tsx` into a self-contained `SessionPanel`. App-level concerns (`dismissedIds`, `visibleSessions`, `document.title` effect) stay in `App.tsx`. All child components are already prop-driven.

- **SessionHeader in grid mode**: In grid mode, SessionHeader shows the DEF logo, a generic label (e.g., "4 sessions"), and the grid/single toggle button. The topic and sessionId fields are hidden. The End Session button is hidden — each `SessionPanel` includes its own end-session control in its panel header bar. In single mode, SessionHeader works exactly as today.

- **StatusBar split — per-panel compact variant**: In grid mode, each `SessionPanel` renders a compact StatusBar showing: status badge, turn count, timer, and collapse/expand-all. The ThemeToggle moves to `SessionHeader` as a global control (always visible). This avoids rendering 4 theme toggles.

- **Session dismiss in grid mode**: Each grid panel's header bar includes a dismiss button (alongside the maximize button) for completed/interrupted sessions. Dismissing a session reflows the grid. This replaces the tab bar's dismiss functionality which is hidden in grid mode.

- **CSS Grid for layout**: Use native CSS Grid (`grid-template-columns`) with Tailwind classes. The grid adapts column count based on session count, not viewport width (except at <768px where grid is disabled).

- **Grid panel height management**: Each grid panel is constrained to its grid cell height via CSS Grid's `1fr` rows. Internally, each panel uses `flex flex-col overflow-hidden` with the `Transcript` ScrollArea taking `flex-1 min-h-0` for scrollable overflow. `InterjectionInput` and `StatusBar` remain fixed at the panel bottom.

- **3-session layout: 2 top + 1 full-width bottom**: Full-width bottom row avoids an awkward empty space and gives the third session more horizontal room for its interactive content. Achieved with `col-span-2` on the third panel in a 2-column grid.

- **Tab bar visibility dual-gating**: Tab bar is hidden if `sessionCount ≤ 1 OR viewMode === 'grid'`. Shown if `sessionCount > 1 AND viewMode === 'single'`. This extends the existing auto-hide logic in `SessionTabBar`.

- **Grid disabled below 768px with auto-fallback**: On narrow viewports, grid mode is forced to single mode. On resize below 768px while in grid mode, auto-switch to single. The localStorage preference is preserved — when viewport grows back above 768px, grid mode is restored from the stored preference. The toggle button is hidden below 768px.

- **Auto-fallback when sessions drop below 2**: If the user is in grid mode and visible sessions drop to 1 or 0, auto-switch to single mode. The localStorage preference is preserved for when sessions increase again.

- **>4 visible sessions**: Show the first 4 visible sessions (by creation order) in the grid. Remaining sessions are accessible by switching to single-session mode and using the tab bar.

- **View mode persisted in localStorage**: Users likely have a preference. Store `'def-view-mode'` key with `'single'` or `'grid'` value.

- **`document.title` in grid mode**: The `document.title` effect stays in `App.tsx`. In grid mode, show `"DEF — N sessions"`. In single mode, show the selected session's topic (current behavior).

- **Toast notifications include session topic**: When `SessionPanel` fires interjection-drop toasts, include the session topic in the message (e.g., `"Rate limiting: Your queued message was not delivered..."`). This disambiguates when multiple panels fire toasts simultaneously.

## Open Questions

### Resolved During Planning

- **3-session layout?** → Full-width bottom row (2 top at 50% + 1 bottom at 100%). Gives the third session more room and avoids empty space.
- **Tab bar in grid mode?** → Hidden (dual-gated: hide if count ≤ 1 OR grid mode). Tab bar's dismiss functionality moves to per-panel dismiss buttons.
- **Small viewports?** → Grid disabled below 768px. Auto-switch to single on resize down; restore grid preference on resize up. Toggle button hidden.
- **>4 sessions?** → First 4 visible sessions shown. Others accessible via single-session mode + tabs.
- **Sessions appearing/disappearing mid-grid?** → Grid reactively updates from the `visibleSessions` array. CSS Grid reflows automatically when panels are added/removed. Auto-fallback to single mode when <2 visible sessions.
- **SessionHeader in grid mode?** → Show generic "N sessions" label and toggle button. Hide topic/sessionId/End Session. End Session moves into each `SessionPanel`.
- **StatusBar in grid mode?** → Per-panel compact variant (status badge, turn count, timer, collapse/expand). ThemeToggle moves to `SessionHeader` as a global control.
- **Session dismiss in grid mode?** → Each panel header has a dismiss button alongside the maximize button.
- **Mock/live dispatch after hook split?** → Each exported hook internally dispatches to its mock or live implementation. `use-mock-explorer.ts` exports both `useMockSessionList` and `useMockSessionTurns`.
- **Elapsed timer placement?** → Moves into `useSessionTurns`. Each panel gets its own 1-second interval.
- **Polling stop logic?** → `useSessionTurns` stops polling based on `TurnsResponse.session_status`, not the sessions prop.
- **`document.title` in grid mode?** → Stays in App.tsx. Shows "DEF — N sessions" in grid mode.
- **Toast disambiguation?** → Include session topic in interjection-drop toast messages.

### Deferred to Implementation

- Exact maximize/dismiss button icons and positioning within the panel header bar — should be determined visually during implementation.
- Keyboard navigation between grid panels and focus management on mode switch.
- Whether InterjectionInput should use a compact single-line variant in grid panels to save vertical space.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

```
┌──────────────────────────────────────────────────┐
│ SessionHeader  [topic]  [grid/single toggle]     │
├──────────────────────────────────────────────────┤
│ SessionTabBar  (hidden in grid mode)             │
├──────────────────────────────────────────────────┤
│                                                  │
│  SINGLE MODE:                                    │
│  ┌──────────────────────────────────────────┐    │
│  │ SessionPanel (selectedSessionId)         │    │
│  │  ├─ PauseBanner                          │    │
│  │  ├─ Transcript (scrollable)              │    │
│  │  ├─ InterjectionInput                    │    │
│  │  └─ StatusBar                            │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  GRID MODE (4 sessions):                         │
│  ┌────────────────────┬─────────────────────┐    │
│  │ SessionPanel [⤢]   │ SessionPanel  [⤢]   │    │
│  │  ├─ PauseBanner    │  ├─ PauseBanner     │    │
│  │  ├─ Transcript     │  ├─ Transcript      │    │
│  │  ├─ Input          │  ├─ Input           │    │
│  │  └─ StatusBar      │  └─ StatusBar       │    │
│  ├────────────────────┼─────────────────────┤    │
│  │ SessionPanel [⤢]   │ SessionPanel  [⤢]   │    │
│  │  (same structure)  │  (same structure)   │    │
│  └────────────────────┴─────────────────────┘    │
│                                                  │
└──────────────────────────────────────────────────┘

Data flow:
  App.tsx
    └─ useSessionList()  →  sessions[], selectedSessionId, owningSessionId
    └─ viewMode state    →  'single' | 'grid'
    └─ SessionPanel (×1 or ×4)
         └─ useSessionTurns(sessionId)  →  PollingState (turns, thinking, etc.)
         └─ internal state: openMap, pendingInterjections, phaseRef
```

## Implementation Units

- [x] **Unit 1: Extract `useSessionTurns` hook and simplify `useExplorer`**

  **Goal:** Separate per-session turn polling from session-list polling so multiple panels can each poll their own session independently.

  **Requirements:** R3 (enables independent per-panel data)

  **Dependencies:** None

  **Files:**
  - Create: `src/ui/src/hooks/use-session-turns.ts`
  - Modify: `src/ui/src/hooks/use-explorer.ts`
  - Modify: `src/ui/src/hooks/use-mock-explorer.ts`
  - Modify: `src/ui/src/lib/types.ts`

  **Approach:**
  - Add `SessionListState` interface to `types.ts`: `{ sessions: SessionSummary[], selectedSessionId: string, setSelectedSessionId: (id: string) => void, owningSessionId: string | null }`.
  - Create `useSessionTurns(sessionId: string, sessions: SessionSummary[])` returning `PollingState`. Extract from `useLiveExplorer`:
    - Per-session state variables (`turns`, `sessionStatus`, `topic`, `turnCount`, `thinking`, `thinkingElapsed`, `statusText`, `sessionTimer`, `phase`, `branchName`, `prUrl`, `prNumber`, `turnsPath`, `artifactsPath`, `artifactNames`)
    - Turn-polling logic (`pollTurns` with setTimeout chaining, fetchingTurnsRef guard, stale-response discard)
    - Elapsed timer interval (1-second tick for `thinkingElapsed` and `sessionTimer`, reading `session.created` from the `sessions` parameter)
  - Stop-polling decision: use `data.session_status` from `TurnsResponse` directly, not the `sessions` prop. This is fresher than the 5s session-list poll.
  - Export `elapsedStr` and `formatDuration` from the new hook file.
  - Simplify `useLiveExplorer` to only handle session-list polling, `selectedSessionId` management, and `owningSessionId`. Return `SessionListState`.
  - **Mock dispatch**: Each exported hook internally checks `isMock`. `use-session-turns.ts` exports `useSessionTurns` which dispatches to `useLiveSesisonTurns` or `useMockSessionTurns`. `use-explorer.ts` exports `useSessionList` which dispatches to `useLiveSessionList` or `useMockSessionList`. Both mock and live are called unconditionally per React hook rules.
  - Update `use-mock-explorer.ts` to export `useMockSessionList` (returning `SessionListState`) and `useMockSessionTurns` (returning `PollingState` based on sessionId).

  **Patterns to follow:**
  - The existing polling pattern in `useLiveExplorer` (setTimeout chaining, ref guards for concurrent fetches, cleanup on unmount)
  - The existing mock dispatch pattern in `useExplorer()` (both called unconditionally, select based on `isMock`)
  - The existing `PollingState` interface in `types.ts`

  **Test scenarios:**
  - `useSessionTurns` polls turns for the given sessionId and stops based on `TurnsResponse.session_status`
  - `useSessionTurns` discards stale responses when sessionId changes
  - `useSessionList` continues polling the session list independently
  - Multiple `useSessionTurns` instances can coexist without interfering
  - Mock mode correctly dispatches to mock implementations for both hooks

  **Verification:**
  - Type-check passes (`npm run typecheck`)
  - Existing tests still pass (`npm test`)
  - Manual: single-session mode works identically to before (no visible behavior change)

- [x] **Unit 2: Create `SessionPanel` component**

  **Goal:** Extract the per-session content area from `App.tsx` into a self-contained, reusable component that manages its own state.

  **Requirements:** R3 (fully interactive panels), R4 (maximize button)

  **Dependencies:** Unit 1

  **Files:**
  - Create: `src/ui/src/components/session-panel.tsx`
  - Modify: `src/ui/src/App.tsx`

  **Approach:**
  - Extract per-session state and rendering from `App.tsx` into `SessionPanel`:
    - **Moves into SessionPanel**: `pendingInterjections`, `openMap`, `prevPhaseRef`, interjection reconciliation (count-based matching), phase-drop detection (with topic-prefixed toast messages), `handleEndSession`.
    - **Stays in App.tsx**: `dismissedIds`, `visibleSessions`, `document.title` effect.
  - The component calls `useSessionTurns(sessionId, sessions)` internally.
  - Props: `sessionId`, `sessions`, `showMaximize` (show maximize button), `showDismiss` (show dismiss button for completed/interrupted sessions), `onMaximize`, `onDismiss`.
  - Renders a panel with: thin header bar (session topic, maximize button, dismiss button) → `PauseBanner` → `Transcript` (scrollable, `flex-1 min-h-0`) → `InterjectionInput` → compact `StatusBar` (status badge, turn count, timer, collapse/expand — no ThemeToggle).
  - Panel uses `flex flex-col overflow-hidden` to constrain to its grid cell height. Transcript gets `flex-1 min-h-0` for proper scroll containment.
  - Phase-drop toast includes session topic: `"Rate limiting: Your queued message was not delivered..."`.
  - `App.tsx` simplifies to: `useSessionList()` → `SessionHeader` → `SessionTabBar` → `SessionPanel`(s) → `Toaster`.

  **Patterns to follow:**
  - Existing component structure in `src/ui/src/components/` (named exports, Tailwind utility classes, `cn()` for conditional classes)
  - The pending-interjection reconciliation pattern currently in `App.tsx` (count-based matching, phase-drop toast)

  **Test scenarios:**
  - `SessionPanel` renders transcript and controls for the given sessionId
  - Panel state (openMap, pendingInterjections) is isolated per instance — changing one panel doesn't affect another
  - Maximize button calls `onMaximize` when clicked
  - Dismiss button calls `onDismiss` for completed/interrupted sessions
  - Phase-drop toast includes the session topic for disambiguation
  - Panel overflow is contained — transcript scrolls within the panel, no overflow to parent

  **Verification:**
  - Type-check passes
  - Existing tests pass
  - Manual: single-session UI is visually identical to before the refactor

- [x] **Unit 3: Add view mode toggle and grid layout**

  **Goal:** Implement the grid/single toggle and responsive CSS Grid layout that renders multiple `SessionPanel` instances.

  **Requirements:** R1 (toggle), R2 (responsive grid layout), R4 (maximize), R5 (tab bar behavior)

  **Dependencies:** Unit 2

  **Files:**
  - Modify: `src/ui/src/App.tsx`
  - Modify: `src/ui/src/components/session-header.tsx`
  - Modify: `src/ui/src/components/status-bar.tsx` (move ThemeToggle to SessionHeader)

  **Approach:**
  - Add `viewMode` state (`'single' | 'grid'`) to `App.tsx`, initialized from `localStorage.getItem('def-view-mode')` with `'single'` as default. Persist on change.
  - **Auto-fallback**: If in grid mode and visible sessions drop to <2, auto-switch to single mode (preserve localStorage preference). If below 768px while in grid mode, auto-switch to single; restore grid preference when viewport grows back above 768px. Use `window.matchMedia('(min-width: 768px)')` with a change listener.
  - **SessionHeader changes**: New props: `viewMode`, `onToggleViewMode`, `sessionCount`. In grid mode: show "N sessions" label instead of topic/sessionId, hide End Session button, show ThemeToggle (moved from StatusBar). Toggle button uses `LayoutGrid` icon (single→grid) and `Maximize2` icon (grid→single). Only show toggle when viewport ≥768px and ≥2 visible sessions.
  - **Tab bar dual-gating**: Pass `viewMode` to the tab bar rendering logic. Hide if `visibleSessions.length ≤ 1 OR viewMode === 'grid'`.
  - **`document.title`**: In grid mode show `"DEF — N sessions"`. In single mode show selected session's topic (current behavior). This effect stays in `App.tsx`.
  - In grid mode: render a CSS Grid container with `SessionPanel` components for up to 4 visible sessions. Grid classes:
    - 1 session: `grid-cols-1` (same as single mode visually)
    - 2 sessions: `grid-cols-2`
    - 3 sessions: `grid-cols-2` with 3rd panel using `col-span-2`
    - 4 sessions: `grid-cols-2`
    - All panels: `grid-rows-[1fr_1fr]` when 2+ sessions for equal row height
  - Each grid panel gets `showMaximize={true}`, `showDismiss={true}` (for completed/interrupted), `onMaximize={() => { setViewMode('single'); setSelectedSessionId(sessionId) }}`, and `onDismiss={() => handleDismissSession(sessionId)}`.
  - Grid panels must be keyed by `sessionId` to preserve scroll position and internal state across re-renders.
  - In single mode: show `SessionTabBar` and render one `SessionPanel` for `selectedSessionId` (existing behavior).

  **Patterns to follow:**
  - Existing responsive patterns in the codebase (Tailwind responsive prefixes)
  - `SessionHeader` prop pattern (extends existing props, adds toggle)
  - localStorage pattern (simple get/set, no framework)

  **Test scenarios:**
  - Toggle switches between grid and single mode
  - Grid layout renders correct number of columns for 1, 2, 3, and 4 sessions
  - 3-session layout has full-width bottom panel
  - Maximize button switches to single mode with that session selected
  - Dismiss button in grid removes the panel and reflows the grid
  - Tab bar is hidden in grid mode, visible in single mode
  - Grid toggle button hidden on narrow viewports
  - View mode preference persists across page reloads
  - Auto-fallback to single mode when visible sessions drop to <2
  - Auto-fallback to single mode on viewport resize below 768px; restore on resize up
  - SessionHeader shows "N sessions" in grid mode, topic in single mode
  - document.title shows "DEF — N sessions" in grid mode

  **Verification:**
  - Type-check passes
  - Manual: toggle works, grid layout is responsive, all interactions work in both modes
  - Visual: 2-session layout shows 50/50 split, 4-session layout shows 2×2 grid, 3-session layout shows 2+1 with full-width bottom

- [x] **Unit 4: Update mock data for grid testing**

  **Goal:** Provide 4 mock sessions with varied statuses so the grid view can be tested in dev mode (`?mock` or `VITE_MOCK=true`).

  **Requirements:** R2 (need 4 sessions to test full grid)

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `src/ui/src/hooks/use-mock-explorer.ts`
  - Modify: `src/ui/src/mocks/mock-session.ts` (if additional mock turn data is needed)

  **Approach:**
  - Add 2 more mock sessions to `MOCK_SESSIONS` with different statuses (e.g., one active, one paused) and different topics.
  - Update `useMockExplorer` to return `SessionListState`.
  - Ensure mock sessions have distinct topics and statuses for visual differentiation in the grid.

  **Patterns to follow:**
  - Existing mock data structure in `use-mock-explorer.ts`

  **Test scenarios:**
  - Mock mode shows 4 sessions in grid view
  - Each mock panel displays its own topic and status

  **Verification:**
  - `npm run dev:ui` with `?mock` query param shows grid with 4 panels

## System-Wide Impact

- **Interaction graph:** `SessionPanel` becomes the new integration seam between `App.tsx` and all per-session components. Existing component props pass through unchanged. `StatusBar` loses ThemeToggle (moves to `SessionHeader`). `SessionHeader` gains view-mode toggle, ThemeToggle, and grid-mode display logic.
- **Error propagation:** Each `useSessionTurns` instance handles its own fetch errors independently (silent retry, same as current behavior). One panel's API failure does not affect others.
- **State lifecycle risks:** Multiple concurrent `useSessionTurns` hooks will make parallel API requests (up to 4 × 3s turn polling + 4 × 1s elapsed timers). The server already handles concurrent reads from the filesystem. Acceptable for a localhost server. Panels may briefly show stale data during the 5s session-list poll gap, but `useSessionTurns` uses `TurnsResponse.session_status` directly for stop-polling decisions, minimizing this window.
- **API surface parity:** No new endpoints. The existing `fetchSessionTurns` API is called per-panel instead of once.
- **Integration coverage:** The main risk is state isolation between panels — one panel's interjection reconciliation or phase tracking shouldn't leak into another. This is handled by `SessionPanel` encapsulating all per-session state. Toast notifications from multiple panels go to the same global `Toaster` — disambiguated by including session topic in toast messages.

## Risks & Dependencies

- **Polling load**: 4 sessions × 3s turn polling = ~1.3 requests/sec to the local server, plus 4 concurrent 1-second elapsed timer intervals. Each request reads from disk. Low risk for a localhost-only server, but worth monitoring if sessions have large turn histories.
- **Scroll position independence**: Each `SessionPanel` contains its own `ScrollArea` (via `Transcript`) with `flex-1 min-h-0` for proper overflow containment. React's component isolation should handle this, but verify that auto-scroll-to-bottom in one panel doesn't affect another.
- **Component key stability**: Grid panels must be keyed by `sessionId` to prevent React from unmounting/remounting panels when sessions reorder. This preserves scroll position and internal state across re-renders.
- **View mode state coherence**: Multiple auto-fallback triggers (viewport resize, session count drop) must not fight with each other or with localStorage persistence. The localStorage stores the user's *preference*; the effective view mode is derived from `preference AND viewport ≥ 768px AND visibleSessions ≥ 2`.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-26-grid-view-requirements.md](docs/brainstorms/2026-03-26-grid-view-requirements.md)
- Related plan: [docs/plans/2026-03-25-002-feat-session-explorer-plan.md](docs/plans/2026-03-25-002-feat-session-explorer-plan.md)
- Related code: `src/ui/src/App.tsx`, `src/ui/src/hooks/use-explorer.ts`, `src/ui/src/lib/types.ts`
