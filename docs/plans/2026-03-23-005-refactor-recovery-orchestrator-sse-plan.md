---
title: "refactor: Recovery correctness, orchestrator extraction, context management, SSE"
type: refactor
status: active
date: 2026-03-23
---

# refactor: Recovery correctness, orchestrator extraction, context management, SSE

## Overview

Four-phase refactoring of ACB's core backend, prioritized by the consensus decisions log from a Claude+Codex collaboration session. The phases are strictly ordered: correctness first, then architecture, then features.

## Problem Statement / Motivation

The ACB orchestrator has several state correctness bugs that can corrupt turn files and block crash recovery. These must be fixed before any transport or feature work. Beyond correctness, the orchestrator's while loop mixes six concerns (invocation, validation, persistence, session update, status branching, interjection draining), making it untestable and difficult to extend with new modes or SSE notifications. Finally, long sessions will exceed model context windows, and the 3-second polling transport wastes file I/O on every tick.

## Proposed Solution

Four phases, each building on the previous:

1. **Recovery & State Correctness** — Fix data corruption and crash recovery bugs
2. **Orchestrator Extraction** — Extract pure transition function, add EventEmitter to controller
3. **Context Window Management** — Token-budgeted prompt builder with truncation
4. **SSE Transport** — Replace polling with Server-Sent Events, keep polling as fallback

## Technical Approach

### Phase 1: Recovery & State Correctness

**Goal:** Every turn file on disk has the correct status. Crash recovery works reliably on Windows.

#### 1a. Fix status downgrade before write

**Bug:** `orchestrator.js:93-111` — `writeCanonicalTurn` is called at line 93 with `status: done`, then lines 103-111 downgrade to `complete` in memory but never rewrite the file.

**Fix:** Move status normalization BEFORE `writeCanonicalTurn`. Create a `normalizeStatus()` function that maps the agent's claimed status to the orchestrator's canonical status:

```javascript
// src/orchestrator.js — new function
function normalizeStatus(agentStatus, turnCount, maxTurns) {
  if (agentStatus === 'done' && turnCount < 2) return 'complete'  // too early
  if (agentStatus === 'done') return 'done'
  if (agentStatus === 'needs_human') return 'needs_human'
  return 'complete'
}
```

Apply BEFORE line 93:
```javascript
canonicalData.status = normalizeStatus(canonicalData.status, turnCount, session.max_turns)
await writeCanonicalTurn(session, canonicalId, canonicalData, validation.content)
```

The `break` after `done` (line 109) stays — it now reads the already-correct `canonicalData.status`.

**Files:** `src/orchestrator.js`

#### 1b. Fix SIGINT handler

**Bug:** `session.js:90-102` — SIGINT sets `session_status: 'completed'` (unrecoverable) and does not kill child processes.

**Fix:**
- Set `session_status: 'interrupted'` instead of `'completed'`
- Store the current `ChildProcess` reference on the controller object in `agent.js`
- On SIGINT, kill the child process tree (Windows: `taskkill /pid /T /F`, Unix: `child.kill('SIGTERM')`)
- Update `recovery.js` to treat `'interrupted'` as recoverable (alongside `'active'` and `'paused'`)

```javascript
// src/session.js — installShutdownHandler
controller.killChild?.()  // new method on controller
await update(sessionDir, { session_status: 'interrupted' })
```

```javascript
// src/agent.js — expose kill handle
controller.killChild = () => {
  if (currentChild) {
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${currentChild.pid} /T /F`).catch(() => {})
    } else {
      currentChild.kill('SIGTERM')
    }
  }
}
```

**Files:** `src/session.js`, `src/agent.js`, `src/recovery.js`

#### 1c. Clean orphaned .tmp files during recovery

**Bug:** `recovery.js:114-117` — Recovery cleans `runtime/` but not orphaned `.tmp` files in `turns/`.

**Fix:** In `doResume()`, after cleaning runtime files, glob `turns/*.tmp` and delete them:

```javascript
const tmpFiles = (await readdir(turnsDir)).filter(f => f.endsWith('.tmp'))
await Promise.all(tmpFiles.map(f => unlink(join(turnsDir, f))))
```

**Files:** `src/recovery.js`

#### 1d. Handle stale lockfiles

**Bug:** `recovery.js:14-19` — If the process died without cleaning the lockfile, recovery is blocked forever.

**Fix:** The lockfile already contains `process.pid`. Read the PID and check if it's alive using `process.kill(pid, 0)` (cross-platform: throws `ESRCH` if dead, `EPERM` or succeeds if alive):

```javascript
function isProcessAlive(pid) {
  try { process.kill(pid, 0); return true }
  catch (e) { return e.code === 'EPERM' }
}
```

If the PID is dead, delete the lockfile and proceed with recovery.

**Files:** `src/recovery.js`, `src/session.js`

#### 1e. Add fsync to both atomic write paths

**Bug:** `session.js:69-73` and `orchestrator.js:219-231` — Neither `atomicWriteJson` nor `writeCanonicalTurn` calls `fsync` before `rename`.

**Fix:** Extract a shared `atomicWrite(path, data)` utility that opens the file handle, writes, fsyncs, closes, then renames. Both `atomicWriteJson` and `writeCanonicalTurn` should use it.

```javascript
// src/util.js (new file)
export async function atomicWrite(finalPath, content) {
  const tmpPath = finalPath + '.tmp'
  const fh = await open(tmpPath, 'w')
  await fh.writeFile(content)
  await fh.sync()
  await fh.close()
  await rename(tmpPath, finalPath)
}
```

**Files:** new `src/util.js`, `src/session.js`, `src/orchestrator.js`

#### Phase 1 Acceptance Criteria

- [ ] Turn files on disk always reflect the normalized status (never `done` when orchestrator continued)
- [ ] SIGINT sets `interrupted`, kills child processes, session is recoverable
- [ ] Recovery cleans `.tmp` files from `turns/`
- [ ] Stale lockfiles (dead PID) are automatically removed during recovery
- [ ] `atomicWrite` calls `fsync` before `rename` in both turn files and session.json
- [ ] All existing behavior preserved (interjection, pause/resume, end-session)

---

### Phase 2: Orchestrator Extraction

**Goal:** The orchestrator's turn loop is decomposed into a testable transition function with event emission.

#### 2a. Extract `computeNextState()` pure function

Extract the status branching logic (lines 103-148 of `orchestrator.js`) into a pure function:

```typescript
interface TurnResult {
  canonicalData: CanonicalTurn
  content: string
}

interface LoopState {
  turnCount: number
  nextAgent: 'claude' | 'codex'
  sessionDone: boolean
  needsHuman: boolean
  interjections: string[]
}

function computeNextState(current: LoopState, turnResult: TurnResult, maxTurns: number): LoopState
```

This function:
- Decides what `nextAgent` should be
- Decides if the session is `done` (status `done` or turn limit reached)
- Decides if the session needs human input
- Does NOT perform I/O (no file writes, no session updates)

The while loop becomes: invoke → validate → computeNextState → persist → (pause if needed) → loop.

**Files:** `src/orchestrator.js`

#### 2b. Add EventEmitter to controller

Extend the `controller` object with a `Node.js EventEmitter`:

```javascript
import { EventEmitter } from 'node:events'

const events = new EventEmitter()
const controller = {
  // ... existing fields ...
  events,
}
```

Emit events at key state transitions:
- `turn:written` — after `writeCanonicalTurn` (payload: `{ id, turn, from, status }`)
- `status:changed` — after `updateSession` changes `session_status` (payload: `{ status }`)
- `thinking:started` — when agent invocation begins (payload: `{ agent }`)
- `thinking:stopped` — when agent invocation completes

These events have no consumers in Phase 2 (the server subscribes in Phase 4). Use `console.debug` log subscriber during development to verify correctness.

**Files:** `src/orchestrator.js`

#### 2c. Add test infrastructure

Use Node.js built-in `node:test` runner (available since Node 20, already a prerequisite). Add test script to root `package.json`:

```json
"test": "node --test src/__tests__/*.test.js"
```

Write tests for:
- `normalizeStatus()` — all status mapping combinations
- `computeNextState()` — done, needs_human, interjection, turn limit
- `atomicWrite()` — write + fsync + rename
- `isProcessAlive()` — live PID, dead PID

**Files:** new `src/__tests__/` directory, `package.json`

#### Phase 2 Acceptance Criteria

- [ ] `computeNextState()` is a pure function with no I/O
- [ ] EventEmitter on controller fires `turn:written`, `status:changed`, `thinking:started`, `thinking:stopped`
- [ ] Tests pass for `normalizeStatus`, `computeNextState`, `atomicWrite`, `isProcessAlive`
- [ ] `npm test` runs and passes
- [ ] Orchestrator behavior is identical (same turn files produced)

---

### Phase 3: Context Window Management

**Goal:** Long sessions don't exceed model context windows. Older turns are truncated with decision metadata preserved.

#### 3a. Token-budgeted prompt builder

Replace the current "concatenate everything" approach in `context.js` with a budgeted builder:

```javascript
const TOKEN_BUDGET = 100_000  // ~80% of Claude's 128K window, conservative
const CHARS_PER_TOKEN = 4     // rough heuristic, safe for English + code

function buildContext(session, turnFiles, mode) {
  const budget = TOKEN_BUDGET * CHARS_PER_TOKEN  // char budget

  // Always include: system prompt + session brief
  let used = systemPrompt.length + sessionBrief.length

  // Include turns newest-first, stop when budget exhausted
  const included = []
  const truncated = []

  for (let i = turnFiles.length - 1; i >= 0; i--) {
    if (used + turnFiles[i].content.length <= budget) {
      included.unshift(turnFiles[i])
      used += turnFiles[i].content.length
    } else {
      truncated.unshift(turnFiles[i])
    }
  }

  // Build truncation notice with preserved decisions
  if (truncated.length > 0) {
    const decisions = truncated.flatMap(t => t.decisions || [])
    const notice = buildTruncationNotice(truncated, decisions)
    // Insert notice before included turns
  }

  return assembledPrompt
}
```

**Key rules (from existing plan docs):**
- Whole-turn truncation only — never split a turn body
- System prompt + session brief always included
- Truncation notice with count of dropped turns and preserved decisions array
- Newest turns have priority (oldest dropped first)

**Files:** `src/context.js`

#### 3b. Truncation notice format

```
[Context truncated: turns 1-8 omitted (8 turns, 12 decisions preserved)]
Decisions from truncated turns:
- Use atomic writes for all persistence
- Keep polling transport for v1
- ...

--- Retained turns below ---
```

#### Phase 3 Acceptance Criteria

- [ ] Sessions with 20+ turns don't exceed 100K character budget
- [ ] Oldest turns truncated first, newest preserved
- [ ] Decisions from truncated turns preserved in notice
- [ ] Turns are never split — whole-turn inclusion or exclusion
- [ ] System prompt and session brief always present
- [ ] Tests for budget calculation and truncation logic

---

### Phase 4: SSE Transport

**Goal:** Replace polling with SSE for real-time UI updates. Polling remains as fallback.

#### 4a. SSE event contract

| Event | Payload | When |
|---|---|---|
| `turn:written` | `{ id, turn, from, status, content }` | After canonical turn persisted |
| `status:changed` | `{ session_status }` | Session status changes |
| `thinking:started` | `{ agent, since }` | Agent invocation begins |
| `thinking:stopped` | `{}` | Agent invocation completes |
| `session:completed` | `{}` | Terminal event, close connection after |

Plus `:keepalive\n\n` comment every 15 seconds to prevent proxy/browser timeouts.

#### 4b. Server SSE endpoint

Add `GET /api/events` to `src/server.js`:

```javascript
async function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // nginx
  })

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Subscribe to controller events
  const onTurn = (data) => send('turn:written', data)
  const onStatus = (data) => send('status:changed', data)
  const onThinkStart = (data) => send('thinking:started', data)
  const onThinkStop = (data) => send('thinking:stopped', data)

  controllerRef.events.on('turn:written', onTurn)
  controllerRef.events.on('status:changed', onStatus)
  controllerRef.events.on('thinking:started', onThinkStart)
  controllerRef.events.on('thinking:stopped', onThinkStop)

  // Heartbeat
  const heartbeat = setInterval(() => res.write(':keepalive\n\n'), 15000)

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat)
    controllerRef.events.off('turn:written', onTurn)
    controllerRef.events.off('status:changed', onStatus)
    controllerRef.events.off('thinking:started', onThinkStart)
    controllerRef.events.off('thinking:stopped', onThinkStop)
  })
}
```

`GET /api/turns` remains as initial-load endpoint (fetch full state on page load, then switch to SSE for deltas).

#### 4c. UI `useEventSource` hook

Replace `use-polling.ts` with a hook that:
1. Fetches full state via `GET /api/turns` on mount
2. Opens `EventSource` to `GET /api/events`
3. Applies incremental updates from SSE events
4. Falls back to polling if `EventSource` errors 3 times consecutively
5. On `session:completed` event, close the connection and stop

```typescript
function useEventSource(): PollingState {
  // Initial fetch
  // Open EventSource
  // On 'turn:written': append turn to state
  // On 'status:changed': update session status
  // On 'thinking:started/stopped': update thinking state
  // On error: increment failure count, fall back to polling after 3
}
```

**Files:** `src/server.js`, `src/ui/src/hooks/use-polling.ts` (replaced or extended)

#### Phase 4 Acceptance Criteria

- [ ] `GET /api/events` streams SSE with correct `Content-Type` and heartbeat
- [ ] UI receives real-time turn updates without polling
- [ ] UI falls back to polling after 3 consecutive SSE failures
- [ ] `GET /api/turns` still works for initial page load
- [ ] SSE connections are cleaned up on client disconnect and server shutdown
- [ ] `session:completed` event closes the SSE stream

---

## Dependencies Between Phases

```
Phase 1 (correctness) ──► Phase 2 (extraction) ──► Phase 3 (context)
                                    │
                                    └──► Phase 4 (SSE)
```

- Phase 2 depends on Phase 1: the transition function needs correct status normalization
- Phase 3 depends on Phase 2: context builder needs the extracted turn metadata interface
- Phase 4 depends on Phase 2: SSE consumes the EventEmitter added in Phase 2
- Phases 3 and 4 are independent of each other and can be done in either order

## Risk Analysis

| Risk | Mitigation |
|---|---|
| Windows subprocess kill doesn't work with `shell: true` | Use `taskkill /pid /T /F` on Windows instead of `child.kill()` |
| Token counting heuristic (`chars/4`) is inaccurate | Budget to 80% of model context, add safety margin |
| SSE connection drops during long agent invocations | 15-second heartbeat prevents proxy/browser timeouts |
| Phase 2 extraction changes orchestrator behavior | Test `computeNextState` exhaustively before wiring |

## Key Decisions (from Decisions Log)

1. **Recovery/correctness FIRST** — both agents agreed this must precede transport or features
2. **Status downgrade before write** — Claude identified, Codex confirmed
3. **Pure transition function** — prerequisite for testability and SSE
4. **SSE with narrow event contract** — not a full WebSocket, just incremental deltas
5. **Token-budgeted context** — `chars/4` heuristic, whole-turn truncation, decision preservation
6. **Backend TypeScript deferred** — wait until contracts stabilize post-refactor

## Sources & References

### Internal References
- Status downgrade bug: `src/orchestrator.js:93-111`
- SIGINT handler: `src/session.js:90-102`
- Recovery scan: `src/recovery.js:14-19`
- Atomic writes: `src/session.js:69-73`, `src/orchestrator.js:219-231`
- Context assembly: `src/context.js:40-42`
- Server polling: `src/server.js:198-236`
- Controller pattern: `src/orchestrator.js:25-40`
- Agent subprocess: `src/agent.js:58-93`
- Plan contradictions: `docs/plans/2026-03-23-003-codex-plan-review.md`
- Original plan: `docs/plans/2026-03-23-001-feat-agent-collaboration-hybrid-handoff-plan.md`
