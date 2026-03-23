---
date: 2026-03-23
topic: rename-to-def
---

# Rename ACB to DEF (Debate Engine Framework)

## Problem Frame
The tool is currently named ACB (Agent Collaboration Bridge), which is generic and forgettable. "DEF" (Debate Engine Framework) better captures the core mechanic: agents challenge each other rather than agreeing.

## Requirements
- R1. Rename the CLI command from `acb` to `def`
- R2. Rename the session directory from `.acb/` to `.def/`
- R3. Rename the package from `agent-collab` to `debate-engine-framework`
- R4. Update all display text, docs, and code references from ACB/Agent Collaboration Bridge to DEF/Debate Engine Framework
- R5. Rename `bin/acb` to `bin/def`

## Scope Boundaries
- No migration from `.acb/` to `.def/` — clean break, existing sessions orphaned
- No changes to behavior or architecture — rename only
- GitHub repo name stays unchanged for now

## Success Criteria
- `def --topic "..."` works end to end
- `npm test` passes
- All references to ACB/acb are replaced

## Key Decisions
- **No migration**: Existing `.acb/` sessions are simply abandoned. Users start fresh with `.def/`.
- **Package name**: `debate-engine-framework` (full name, kebab-case)

## Next Steps
→ `/ce:plan` for structured implementation planning
