---
date: 2026-03-26
topic: grid-view-layout
---

# Grid View for Multi-Session Display

## Problem Frame
The DEF UI currently shows one session at a time via a tab bar. When monitoring multiple concurrent sessions, users must switch tabs to check on each one. A grid view would let users observe up to four sessions simultaneously without tab-switching.

## Requirements
- R1. A toggle button switches between **full-screen mode** (current single-session view) and **grid mode** (multiple sessions visible simultaneously).
- R2. Grid mode displays up to 4 sessions in a responsive layout:
  - 1 session: full width (same as full-screen mode).
  - 2 sessions: side-by-side, each 50% width.
  - 3 sessions: 2 on top (50% each), 1 on bottom (50% or full width — layout detail deferred to planning).
  - 4 sessions: 2×2 grid, each 25% of viewport.
- R3. Each grid panel is a **fully interactive** mini-session view — scrollable transcript, interjection input, thinking indicator, expand/collapse turns, and all existing controls.
- R4. Each grid panel has a **dedicated maximize button** that switches that session to full-screen mode.
- R5. The existing tab bar and session selection continue to work in full-screen mode. Grid mode shows all active sessions without requiring tab selection.

## Success Criteria
- Users can toggle between grid and full-screen with a single click.
- Grid layout adapts correctly for 1–4 sessions without manual configuration.
- All session interactions (interject, expand/collapse, end session) work from within a grid panel.

## Scope Boundaries
- Grid supports a maximum of 4 sessions. If more than 4 exist, behavior is deferred to planning (e.g., show first 4 active, or paginate).
- No drag-and-drop reordering of grid panels.
- No resizable panel splits — layout is automatic based on session count.

## Key Decisions
- **Dedicated maximize button** (not click-to-expand): Avoids accidental mode switches when interacting with panel content.
- **Full interactive panels**: Each grid cell is a complete session view, not a summary — users can work across sessions without maximizing.

## Outstanding Questions

### Deferred to Planning
- [Affects R2][Needs research] What is the best layout for 3 sessions? Two options: top row 2×50% + bottom row 1×50% left-aligned, or top row 2×50% + bottom row 1×100% full width.
- [Affects R2][Technical] How should the grid handle sessions that appear or disappear while in grid view (e.g., a new session spawns, or a session completes and is dismissed)?
- [Affects R5][Technical] Should the tab bar be hidden in grid mode, or remain visible as a secondary navigation?
- [Affects R3][Technical] At small viewport sizes (e.g., <768px), should grid mode be disabled or collapse to a single column?

## Next Steps
→ `/ce:plan` for structured implementation planning
