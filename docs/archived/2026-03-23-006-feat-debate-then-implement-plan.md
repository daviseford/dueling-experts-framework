---
title: "feat: Debate-then-implement session lifecycle"
type: feat
status: active
date: 2026-03-23
origin: docs/brainstorms/2026-03-23-debate-then-implement-requirements.md
---

# feat: Debate-then-implement session lifecycle

## Overview

Extend DEF from a debate-only engine to a full decision-to-execution loop. Sessions progress through three phases — debate, implement, review — with agents self-governing phase transitions. The implementing agent produces structured action instructions; DEF parses and executes them in a sandboxed manner. A mandatory review loop ensures quality.

## Problem Statement / Motivation

DEF produces debate output and a decisions artifact, then stops. Users must manually translate decisions into action. Closing the loop makes DEF an autonomous "decide and do" engine. (see origin: `docs/brainstorms/2026-03-23-debate-then-implement-requirements.md`)

## Proposed Solution

### Phase model

Add a `phase` field to `session.json` with values: `debate` | `implement` | `review`. The orchestrator checks `phase` at the top of each turn loop iteration and dispatches to phase-specific logic.

### Consensus signaling (R2)

Add `decided` to the valid status enum. When an agent emits `decided`:
- If this is the **first** `decided` in the current debate round, record it and give the other agent a turn.
- If the other agent **also** emits `decided`, consensus is reached — transition to `implement` phase.
- If the other agent emits `complete` instead, the `decided` flag is cleared and debate continues. The debate turn budget keeps ticking (no reset).

### Implementation phase (R3, R4, R7)

The `--impl-model` CLI flag (default: `claude`) selects which agent runs implementation. The implementing agent receives a special prompt containing:
1. The full debate decisions log
2. A structured-actions instruction set (see format below)
3. The original topic

The agent produces a response containing fenced action blocks. DEF parses and executes them.

### Review phase (R5, R6)

After implementation, the non-implementing agent reviews the changes. It receives:
1. The debate decisions
2. The actions that were executed and their outcomes
3. A review prompt asking it to approve or request fixes

If the reviewer emits `done` → session complete. If `complete` → the implementer gets another turn. This loops up to `--review-turns` (default: 6) turns total in the review phase.

## Technical Approach

### Phase 1: Schema and CLI changes

**Files:** `src/index.js`, `src/session.js`, `src/validation.js`

#### 1a. Add `--impl-model` and `--review-turns` CLI flags

`src/index.js`:
- Add `--impl-model` to `parseArgs()` (values: `claude`, `codex`; default: `claude`)
- Add `--review-turns` to `parseArgs()` (default: `6`)
- Validate both in the existing validation block
- Pass `implModel` and `reviewTurns` to `session.create()`

#### 1b. Extend session schema

`src/session.js` — `create()`:
```js
const session = {
  // ...existing fields...
  phase: 'debate',          // NEW: debate | implement | review
  impl_model: implModel,    // NEW: which agent implements
  review_turns: reviewTurns, // NEW: max review loop turns
};
```

#### 1c. Add `decided` status

`src/validation.js`:
- Change `VALID_STATUS` regex to `/^(complete|needs_human|done|decided|error)$/`

`src/orchestrator.js` — `normalizeStatus()`:
- Add: `if (agentStatus === 'decided') return 'decided';`
- Keep existing downgrade logic for `done` on turn < 2

**Tests:**
- `src/__tests__/normalizeStatus.test.js`: add cases for `decided` status
- `src/__tests__/validate.test.js`: add case for `decided` in valid status enum

### Phase 2: Consensus detection in orchestrator

**File:** `src/orchestrator.js`

Add consensus tracking state at the top of `run()`:
```js
let pendingDecided = null; // agent name that emitted first `decided`
```

After writing a canonical turn, before the existing `done`/`needs_human` checks, add:

```js
if (canonicalData.status === 'decided') {
  if (pendingDecided && pendingDecided !== nextAgent) {
    // Both agents agreed — transition to implement
    console.log(`[Turn ${turnCount}] Consensus reached. Transitioning to implement phase.`);
    await updateSession(session.dir, { phase: 'implement' });
    session.phase = 'implement';
    pendingDecided = null;
    // Next agent is the impl_model
    nextAgent = session.impl_model;
    await updateSession(session.dir, { next_agent: nextAgent });
    continue;
  } else {
    // First decided — record and let the other agent respond
    pendingDecided = nextAgent;
    console.log(`[Turn ${turnCount}] ${nextAgent} signals decided. Waiting for ${oppositeAgent} to confirm.`);
  }
}
```

If the other agent responds with `complete` instead of `decided`:
```js
if (pendingDecided && canonicalData.status === 'complete') {
  console.log(`[Turn ${turnCount}] ${nextAgent} contests. Resuming debate.`);
  pendingDecided = null;
}
```

### Phase 3: Structured action format and executor

**New file:** `src/actions.js`

#### Action format

The implementing agent wraps each action in a fenced block with a `def-action` info string:

````markdown
```def-action
type: write-file
path: src/example.js
---
const foo = 'bar';
```
````

````markdown
```def-action
type: edit-file
path: src/example.js
search: const foo = 'bar';
---
const foo = 'baz';
```
````

````markdown
```def-action
type: shell
cmd: npm test
cwd: .
```
````

````markdown
```def-action
type: mkdir
path: src/new-dir
```
````

This format is easy for agents to produce (it's markdown-native), easy to parse, and clearly delimited.

#### Supported operations

| Type | Description | Fields |
|------|-------------|--------|
| `write-file` | Create or overwrite a file | `path`, content after `---` |
| `edit-file` | Search-and-replace in a file | `path`, `search`, replacement after `---` |
| `shell` | Run a shell command | `cmd`, optional `cwd` (relative to target repo) |
| `mkdir` | Create a directory | `path` |

**Excluded:** No `delete-file`, no `git` operations, no network requests. These can be added later if needed.

#### Parser: `parseActions(turnContent)`

```js
export function parseActions(content) {
  const actions = [];
  const regex = /```def-action\n([\s\S]*?)```/g;
  // For each match, parse the YAML header and optional body (split on first "---\n")
  // Return array of { type, ...fields, body? }
  return actions;
}
```

#### Executor: `executeActions(actions, targetRepo)`

```js
export async function executeActions(actions, targetRepo) {
  const results = [];
  for (const action of actions) {
    try {
      switch (action.type) {
        case 'write-file': // writeFile with atomicWrite
        case 'edit-file':  // read, search-replace, atomicWrite
        case 'shell':      // spawn with timeout, capture output
        case 'mkdir':      // mkdir recursive
      }
      results.push({ action, ok: true });
    } catch (err) {
      results.push({ action, ok: false, error: err.message });
    }
  }
  return results;
}
```

**Security constraints:**
- All `path` fields are resolved relative to `targetRepo` and validated against path traversal (`..`)
- `shell` commands have a 60s timeout and 5MB output cap
- No action can write outside `targetRepo`

**Tests:** `src/__tests__/actions.test.js`
- `parseActions`: parses write-file, edit-file, shell, mkdir blocks
- `parseActions`: returns empty array for content with no action blocks
- `parseActions`: handles malformed blocks gracefully
- `executeActions`: write-file creates a file (use temp dir)
- `executeActions`: edit-file replaces content
- `executeActions`: rejects path traversal attempts
- `executeActions`: shell command timeout

### Phase 4: Phase-aware context assembly

**File:** `src/context.js`

#### New prompt builders

`implementPrompt(agent, topic, decisions)` — tells the agent it is implementing the debate's decisions. Includes:
- The decisions list
- Instructions to produce `def-action` blocks
- The action format reference
- Instruction to emit `status: complete` when done

`reviewPrompt(agent, topic, decisions, actionResults)` — tells the agent to review the implementation. Includes:
- The decisions list
- The actions executed and their results (success/failure, output)
- Instructions to emit `status: done` if approved or `status: complete` with feedback if fixes needed

#### Modify `assemble()`

Read `session.phase` and dispatch:
- `debate` → existing `planningPrompt()` (unchanged)
- `implement` → `implementPrompt()` + prior turns from implement phase only
- `review` → `reviewPrompt()` + implementation turns + review turns

**Tests:** `src/__tests__/context.test.js` — add cases for implement and review prompts

### Phase 5: Phase-aware orchestrator loop

**File:** `src/orchestrator.js`

The main `while` loop needs phase-specific behavior:

```js
while (turnCount < session.max_turns && !endRequested) {
  const phase = session.phase || 'debate';

  if (phase === 'debate') {
    // Existing debate logic (alternate agents, check consensus)
  } else if (phase === 'implement') {
    // Only the impl_model agent takes turns
    // After each turn, parse actions and execute them
    // Store action results in session for review prompt
    // Transition to review when agent emits `complete`
    nextAgent = session.impl_model;
  } else if (phase === 'review') {
    // Only the reviewing agent (opposite of impl_model) takes turns
    // If done → session complete
    // If complete → back to implement for fixes
    // Track review turn count against review_turns limit
  }
}
```

**Implementation detail for implement phase:**
After writing the canonical turn, parse the turn body for actions:
```js
const actions = parseActions(validation.content);
if (actions.length > 0) {
  const results = await executeActions(actions, session.target_repo);
  // Write action results to session (for review prompt)
  await writeActionResults(session, turnCount, results);
}
// Transition to review
await updateSession(session.dir, { phase: 'review' });
session.phase = 'review';
```

**Implementation detail for review phase:**
```js
let reviewTurnCount = 0;
// ...in the review branch:
reviewTurnCount++;
if (canonicalData.status === 'done') {
  // Approved — session complete
  break;
} else {
  if (reviewTurnCount >= session.review_turns) {
    console.log('Review turn limit reached. Ending session.');
    break;
  }
  // Switch back to implement for fixes
  await updateSession(session.dir, { phase: 'implement' });
  session.phase = 'implement';
}
```

### Phase 6: Action results storage

**New file pattern:** `{session.dir}/artifacts/action-results-{turnCount}.json`

Each implementation turn's action results are stored as JSON:
```json
[
  { "type": "write-file", "path": "src/foo.js", "ok": true },
  { "type": "shell", "cmd": "npm test", "ok": true, "output": "..." }
]
```

These files are read by the review prompt builder to show the reviewer what happened.

### Phase 7: UI and API updates

**File:** `src/server.js`

The `GET /api/turns` response should include the current phase:
```js
// Add to the response object:
phase: sessionRef.phase || 'debate',
```

The React UI (`src/ui/`) should display the current phase in the status bar. This is a minor UI change — add a phase badge next to the existing session info.

## System-Wide Impact

- **Interaction graph**: CLI → `session.create()` (adds phase, impl_model, review_turns) → `orchestrator.run()` (phase-aware loop) → `agent.invoke()` (same as before) → `actions.parseActions()` + `actions.executeActions()` (new) → filesystem writes
- **Error propagation**: Action execution failures are captured per-action and reported to the review agent. A single failed action does not crash the session. Shell command timeouts are caught.
- **State lifecycle risks**: The `phase` field in `session.json` is the single source of truth. If a crash occurs mid-implementation, recovery resumes from the last phase state. Partially-executed actions may leave files in an intermediate state — the review agent can catch this.
- **API surface parity**: The `/api/turns` endpoint gains a `phase` field. No breaking changes.

## Acceptance Criteria

- [ ] `def --topic "..." --impl-model codex` creates a session with `phase: debate` and `impl_model: codex`
- [ ] Agent emitting `decided` status is validated and accepted
- [ ] When both agents emit `decided`, session transitions to `implement` phase
- [ ] When one agent contests with `complete`, debate continues without turn counter reset
- [ ] Implementation agent receives decisions and action-format instructions in prompt
- [ ] `def-action` blocks in agent output are parsed into structured actions
- [ ] `write-file`, `edit-file`, `shell`, and `mkdir` actions execute correctly
- [ ] Path traversal attempts are rejected
- [ ] Review agent receives action results in prompt
- [ ] Review approval (`done`) ends the session
- [ ] Review rejection (`complete`) triggers another implement turn
- [ ] Review loop respects `--review-turns` limit
- [ ] `GET /api/turns` includes `phase` in response
- [ ] All existing tests still pass
- [ ] New tests cover: `decided` status normalization, action parsing, action execution, path traversal rejection

## Dependencies & Prerequisites

- The ACB→DEF rename should be landed first (the branch `refactor/recovery-correctness` is in progress). This plan assumes DEF naming throughout.
- No new npm dependencies needed — action parsing uses regex on markdown, shell execution uses `node:child_process`.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-03-23-debate-then-implement-requirements.md](docs/brainstorms/2026-03-23-debate-then-implement-requirements.md) — Key decisions: hybrid execution (agent produces text, DEF executes), agent-signaled consensus, mandatory review with fix loop
- Architecture: `src/orchestrator.js` (turn loop), `src/session.js` (session state), `src/validation.js` (status enum), `src/context.js` (prompt assembly), `src/agent.js` (agent invocation)
- Test patterns: `src/__tests__/normalizeStatus.test.js`, `src/__tests__/validate.test.js`
