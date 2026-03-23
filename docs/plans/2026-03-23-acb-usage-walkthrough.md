---
date: 2026-03-23
topic: acb-usage-walkthrough
related: docs/plans/2026-03-23-001-feat-agent-collaboration-hybrid-handoff-plan.md
---

# ACB Usage Walkthrough

Concrete examples of what happens when you use the `acb` CLI. Shows expected artifacts, CLI output, UI behavior, agent prompts, and turn-by-turn flow.

---

## Scenario 1: Planning Session

**Command:**

```bash
cd ~/Projects/kinetic-xyz
acb --topic "Plan Phantom wallet deep-link support on mobile"
```

### What Happens (Step by Step)

#### 1. Session Initialization (~1 second)

**CLI output:**

```
Session created: 2026-03-23-a1b2c3d4
Mode: planning
First agent: claude
Max turns: 20
Watcher UI: http://localhost:3334

Starting session...
```

**Files created:**

```
kinetic-xyz/
└── .acb/
    └── sessions/
        └── 2026-03-23-a1b2c3d4/
            ├── session.md
            ├── turns/          (empty)
            ├── artifacts/      (empty)
            └── runtime/
                ├── claude/
                └── codex/
```

**`session.md` contents:**

```yaml
---
id: 2026-03-23-a1b2c3d4
topic: "Plan Phantom wallet deep-link support on mobile"
mode: planning
max_turns: 20
first_agent: claude
target_repo: /home/davis/Projects/kinetic-xyz
created: 2026-03-23T14:00:00Z
session_status: active
---
```

**`.gitignore` updated** (if `.acb/` not already present):

```
# Agent Collaboration Bus
.acb/
```

#### 2. Turn 1 — Claude (30-90 seconds)

**Orchestrator writes prompt file:**

`.acb/sessions/.../runtime/claude/prompt.md`:

```markdown
You are Claude, one of two AI agents in a structured planning session. The other
agent is Codex. A human operator (Davis) is observing and may interject.

SESSION TOPIC: Plan Phantom wallet deep-link support on mobile

YOUR RESPONSIBILITIES:

- Own the high-level architecture: system boundaries, component relationships,
  data flow, and integration points
- Evaluate product implications: does this approach serve the user well? Are
  there simpler framings?
- Identify scope risks: what is being over-built, under-specified, or deferred
  without justification?
- Produce concrete proposals, not abstract options. State your recommendation
  and why.

WHAT YOU CHALLENGE CODEX ON:

- Implementation proposals that add unnecessary complexity or carrying cost
- Premature optimization or over-engineering
- Missing error cases or failure modes
- Approaches that solve the technical problem but miss the user problem

WHEN TO ESCALATE TO DAVIS:

- Product decisions that require user or stakeholder judgment
- Scope trade-offs where you and Codex disagree after one exchange
- Ambiguity in requirements that neither agent can resolve

CONVERSATION RULES:

- Be direct and concise. This is a dialogue, not a monologue.
- Do not restate what was already said. Build on it or challenge it.
- Disagree openly when you have a better approach.
- When you reach a notable decision, add it to the decisions array in your
  response frontmatter.
- When you believe the planning objective is met, set status: done.
- If you need Davis's input, set status: needs_human and explain what you need.

## Session Brief

Topic: Plan Phantom wallet deep-link support on mobile
Mode: planning

## Your Turn

This is turn 1 — you are opening the conversation. Introduce the problem,
propose an initial architecture, and identify the key decisions that need to be made.

Respond with YAML frontmatter followed by your markdown response.
Required frontmatter fields: id, turn, from, timestamp, status, decisions.
```

**Orchestrator invokes:**

```bash
claude --print < .acb/sessions/.../runtime/claude/prompt.md
```

**Claude's raw output** (captured from stdout, written to `runtime/claude/output.md`):

```markdown
---
id: turn-0001-claude
turn: 1
from: claude
timestamp: 2026-03-23T14:01:30Z
status: complete
decisions:
  - "Use Solana deep-link protocol (solana:) not custom URI scheme"
---

## Phantom Wallet Deep-Link Architecture

The core challenge is connecting a mobile web app to Phantom's native wallet for transaction signing. Here's my proposed approach:

### Architecture

1. **Deep-link trigger:** User taps "Connect Wallet" → app constructs a `solana:` URI with the transaction payload → OS opens Phantom
2. **Return flow:** Phantom signs and redirects back via our app's universal link (`kinetic.xyz/phantom-callback`)
3. **State management:** Transaction intent stored in localStorage before redirect; matched on return

### Key Decisions Needed

1. Should we support WalletConnect as a fallback for wallets that don't support deep-links?
2. Is the transaction payload constructed client-side or server-side?
3. How do we handle the case where Phantom isn't installed?

### Scope Risks

- Deep-link behavior varies significantly between iOS and Android
- Universal link configuration requires server-side `apple-app-site-association` and `assetlinks.json`

I'd like Codex to evaluate the feasibility of the universal link return flow and flag any platform-specific gotchas.
```

**Orchestrator validates:**

- Parses frontmatter with `gray-matter` ✓
- Required fields present (`id`, `turn`, `from`, `timestamp`, `status`, `decisions`) ✓
- `status` is valid enum value (`complete`) ✓
- `from` matches expected agent (`claude`) ✓

**Orchestrator ignores agent-provided `turn` and `id`, generates its own:**

- Canonical filename: `turn-0001-claude.md`
- Canonical ID: `turn-0001-claude`

**File written:** `.acb/sessions/.../turns/turn-0001-claude.md`

**CLI output:**

```
[Turn 1] Claude (complete) — 1 decision
```

**Watcher UI** (if open at localhost:3334): New turn appears within 3 seconds.

```
┌─────────────────────────────────────────────────┐
│ ACB Session: Plan Phantom wallet deep-link...   │
│ Mode: planning | Turn: 1/20 | Status: active    │
├─────────────────────────────────────────────────┤
│                                                 │
│ [CLAUDE] Turn 1 • 14:01:30                      │
│ ─────────────────────────                       │
│ ## Phantom Wallet Deep-Link Architecture        │
│                                                 │
│ The core challenge is connecting a mobile web   │
│ app to Phantom's native wallet for transaction  │
│ signing. Here's my proposed approach...         │
│ ...                                             │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Type a message to interject...]        [Send]  │
└─────────────────────────────────────────────────┘
```

#### 3. Turn 2 — Codex (30-90 seconds)

**Orchestrator writes prompt file:**

`.acb/sessions/.../runtime/codex/prompt.md`:

```markdown
You are Codex, one of two AI agents in a structured planning session. The other
agent is Claude. A human operator (Davis) is observing and may interject.

SESSION TOPIC: Plan Phantom wallet deep-link support on mobile

YOUR RESPONSIBILITIES:

- Own implementation feasibility: can this actually be built as proposed? What
  are the real constraints?
- Evaluate technical trade-offs: performance, maintainability, dependency cost,
  and operational complexity
- Identify concrete implementation risks: what will be harder than it looks?
  What has hidden dependencies?
- Propose specific technical approaches with rationale, not just concerns

WHAT YOU CHALLENGE CLAUDE ON:

- Architecture proposals that sound clean but are impractical to implement
- Scope that is too ambitious for the stated constraints
- Abstractions that add indirection without clear payoff
- Assumptions about library or API capabilities that may not hold

WHEN TO ESCALATE TO DAVIS:

- Resource or timeline constraints that affect feasibility
- Technical choices that have significant cost or vendor implications
- Cases where both approaches are viable and the trade-off is a preference call

CONVERSATION RULES:

- Be direct and concise. This is a dialogue, not a monologue.
- Do not restate what was already said. Build on it or challenge it.
- Disagree openly when you have a better approach.
- When you reach a notable decision, add it to the decisions array in your
  response frontmatter.
- When you believe the planning objective is met, set status: done.
- If you need Davis's input, set status: needs_human and explain what you need.

## Session Brief

Topic: Plan Phantom wallet deep-link support on mobile
Mode: planning

## Prior Turns

### Turn 1 (claude)

---

id: turn-0001-claude
turn: 1
from: claude
timestamp: 2026-03-23T14:01:30Z
status: complete
decisions:

- "Use Solana deep-link protocol (solana:) not custom URI scheme"

---

## Phantom Wallet Deep-Link Architecture

The core challenge is connecting a mobile web app to Phantom's native wallet...
[full content of turn 1]

## Your Turn

Respond to Claude's proposal. Evaluate feasibility, flag risks, and propose
specific technical approaches.

Respond with YAML frontmatter followed by your markdown response.
Required frontmatter fields: id, turn, from, timestamp, status, decisions.
```

**Orchestrator invokes:**

```bash
codex exec --full-auto --no-project-doc -o .acb/sessions/.../runtime/codex/output.md < .acb/sessions/.../runtime/codex/prompt.md
```

**Codex responds, orchestrator validates and persists** → `turns/turn-0002-codex.md`

**CLI output:**

```
[Turn 2] Codex (complete) — 2 decisions
```

#### 4. Turns 3-8 — Alternating (5-15 minutes total)

The agents continue alternating. Each turn's prompt includes all prior turn files as context. Typical 8-turn planning session:

| Turn | Agent  | Status      | Content Summary                                                                  |
| ---- | ------ | ----------- | -------------------------------------------------------------------------------- |
| 1    | Claude | complete    | Proposes deep-link architecture                                                  |
| 2    | Codex  | complete    | Evaluates feasibility, flags iOS universal link complexity                       |
| 3    | Claude | complete    | Simplifies return flow, proposes fallback for no-Phantom case                    |
| 4    | Codex  | needs_human | Asks Davis: server-side or client-side transaction construction?                 |
| 5    | Human  | complete    | Davis: "Client-side. We don't want to touch transaction payloads on the server." |
| 6    | Codex  | complete    | Proposes client-side signing flow with @solana/web3.js                           |
| 7    | Claude | complete    | Reviews error handling, suggests retry UX                                        |
| 8    | Codex  | done        | Agrees plan is complete, lists implementation steps                              |

#### 5. Turn 4 — Escalation Example (needs_human)

Codex sets `status: needs_human` in its frontmatter. The orchestrator:

1. Writes canonical turn file `turn-0004-codex.md`
2. Updates `session_status` in `session.md` to `paused`
3. Pauses the turn loop (awaits a Promise)

**CLI output:**

```
[Turn 4] Codex (needs_human) — 0 decisions
⚠ Agent needs human input. Waiting...
  Reason: "Need a product decision: should transaction payloads be constructed
  client-side or server-side? This affects the security model significantly."
```

**Watcher UI:**

```
┌─────────────────────────────────────────────────┐
│ ⚠ CODEX NEEDS YOUR INPUT                       │
│ Should transaction payloads be constructed       │
│ client-side or server-side?                      │
├─────────────────────────────────────────────────┤
│ [CLAUDE] Turn 1 • 14:01                         │
│ ...                                             │
│ [CODEX] Turn 2 • 14:02                          │
│ ...                                             │
│ [CLAUDE] Turn 3 • 14:04                         │
│ ...                                             │
│ [CODEX] Turn 4 • 14:05 ⚠ NEEDS HUMAN           │
│ Need a product decision: should transaction...   │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Client-side. We don't want to...]      [Send]  │
└─────────────────────────────────────────────────┘
```

Davis types a response and clicks Send. The UI sends `POST /api/interject`. The orchestrator:

1. Receives the human response (bypasses queue — PAUSED state direct inject)
2. Writes `turn-0005-human.md` as a canonical turn
3. Updates `session_status` to `active`
4. Resumes the turn loop with Codex (the agent that escalated, per R11)

**CLI output:**

```
[Turn 5] Human (complete) — 0 decisions
  Resuming with codex...
```

#### 6. Turn 8 — Session Completion

Codex sets `status: done`. The orchestrator gives Claude one final turn:

**CLI output:**

```
[Turn 8] Codex (done) — 3 decisions
  Codex signals session complete. Giving Claude a final turn...
```

Claude responds with `status: done` (confirms):

```
[Turn 9] Claude (done) — 1 decision
  Both agents agree session is complete. Generating artifacts...
```

#### 7. Artifact Generation (~10 seconds)

**Orchestrator generates:**

**`.acb/sessions/.../artifacts/decisions.md`:**

```markdown
# Decisions

1. Use Solana deep-link protocol (solana:) not custom URI scheme _(Turn 1, Claude)_
2. iOS requires apple-app-site-association for universal links _(Turn 2, Codex)_
3. Skip WalletConnect for v1; deep-links only _(Turn 3, Claude)_
4. Transaction payloads constructed client-side _(Turn 5, Human)_
5. Use @solana/web3.js Transaction class for payload construction _(Turn 6, Codex)_
6. Show "Install Phantom" prompt if deep-link fails after 2s timeout _(Turn 7, Claude)_
7. Implement as a React hook: usePhantomDeepLink() _(Turn 8, Codex)_
```

**`.acb/sessions/.../artifacts/final-summary.md`:**
Generated by invoking `claude --print` with the full transcript and a synthesis prompt.

```markdown
# Session Summary: Phantom Wallet Deep-Link Support

## Approach

Client-side deep-link integration using the Solana URI protocol...

## Key Decisions

[consolidated from decisions.md]

## Implementation Steps

1. Create usePhantomDeepLink() React hook
2. Configure universal links (apple-app-site-association, assetlinks.json)
3. Build transaction construction with @solana/web3.js
4. Add fallback UX for missing Phantom
5. Test on iOS and Android

## Open Items

- Test deep-link behavior on Android WebView
- Verify Phantom's latest deep-link API version
```

**Session status updated:**
`session_status: completed` in `session.md`

**CLI output:**

```
Session complete!
  Turns: 9 (7 agent, 1 human, 1 system)
  Decisions: 7
  Artifacts: .acb/sessions/2026-03-23-a1b2c3d4/artifacts/

  decisions.md   — 7 decisions extracted
  final-summary.md — session synthesis
```

#### 8. Final Session Directory

```
.acb/sessions/2026-03-23-a1b2c3d4/
├── session.md              # session_status: completed
├── turns/
│   ├── turn-0001-claude.md
│   ├── turn-0002-codex.md
│   ├── turn-0003-claude.md
│   ├── turn-0004-codex.md   # status: needs_human
│   ├── turn-0005-human.md
│   ├── turn-0006-codex.md
│   ├── turn-0007-claude.md
│   ├── turn-0008-codex.md   # status: done
│   └── turn-0009-claude.md  # status: done (confirmation)
├── artifacts/
│   ├── decisions.md
│   └── final-summary.md
└── runtime/                 # safe to delete
    ├── claude/
    │   ├── prompt.md         # last prompt sent to Claude
    │   └── output.md         # last raw output from Claude
    └── codex/
        ├── prompt.md         # last prompt sent to Codex
        └── output.md         # last raw output from Codex
```

---

## Scenario 2: Human Interjection Mid-Turn

**Setup:** Session is running, Codex is mid-response (30 seconds into a turn).

**Davis types in the UI:** "Also consider supporting Solflare wallet, not just Phantom."

**What happens:**

1. `POST /api/interject` → server returns `{ "ok": true }`
2. Interjection is added to the queue (a plain array)
3. Codex finishes its turn → orchestrator validates and persists
4. At the turn boundary, orchestrator checks the queue: 1 item pending
5. Orchestrator writes `turn-NNNN-human.md` with Davis's message
6. Next agent (Claude) receives all prior turns including the human interjection in its context

**CLI output:**

```
[Turn 4] Codex (complete) — 1 decision
[Turn 5] Human (complete) — interjection
[Turn 6] Claude → invoking...
```

**Key:** The interjection does NOT interrupt Codex. It waits for the turn boundary.

---

## Scenario 3: Agent Error + Retry

**Setup:** Codex CLI times out (takes >120 seconds).

**What happens:**

1. Orchestrator's timeout fires after 120s → kills the Codex process
2. Orchestrator retries once (immediately, same prompt)
3. If retry succeeds: turn persisted, session continues normally
4. If retry fails: orchestrator writes an error turn and pauses

**CLI output (retry succeeds):**

```
[Turn 4] Codex — timeout (120s), retrying...
[Turn 4] Codex (complete) — 0 decisions (retry succeeded)
```

**CLI output (retry fails):**

```
[Turn 4] Codex — timeout (120s), retrying...
[Turn 4] Codex — timeout (120s), retry failed
[Turn 4] System (error) — "Codex timed out after 2 attempts"
⚠ Session paused. Waiting for human input...
```

**Error turn file** (`turn-0004-system.md`):

```yaml
---
id: turn-0004-system
turn: 4
from: system
timestamp: 2026-03-23T14:10:00Z
status: error
decisions: []
error_detail: "codex exec timed out after 120s (2 attempts)"
---

The orchestrator was unable to get a response from Codex for this turn.
The session is paused. You can:
- Retry by sending any message
- Skip Codex and let Claude continue
- End the session
```

---

## Scenario 4: What Davis Sees in the UI

### Live Session View

```
┌──────────────────────────────────────────────────────┐
│  ACB • Plan Phantom wallet deep-link support         │
│  planning • Turn 6/20 • active           [End Session]│
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌ CLAUDE  Turn 1 • 2:01 PM ─────────────────────┐   │
│  │ ## Phantom Wallet Deep-Link Architecture       │   │
│  │ The core challenge is connecting a mobile...   │   │
│  │ Decisions: Use Solana deep-link protocol       │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ CODEX  Turn 2 • 2:02 PM ──────────────────────┐   │
│  │ Claude's architecture is workable but the      │   │
│  │ universal link return flow needs attention...  │   │
│  │ Decisions: iOS requires apple-app-site-assoc   │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ CLAUDE  Turn 3 • 2:04 PM ─────────────────────┐   │
│  │ Good point on universal links. Simplified      │   │
│  │ proposal: skip WalletConnect for v1...         │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ CODEX  Turn 4 • 2:05 PM ⚠ ────────────────────┐   │
│  │ Need a product decision from Davis: should     │   │
│  │ transaction payloads be constructed client-side │   │
│  │ or server-side?                                │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ DAVIS  Turn 5 • 2:06 PM ──────────────────────┐   │
│  │ Client-side. We don't want to touch            │   │
│  │ transaction payloads on the server.            │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
│  ┌ CODEX  Turn 6 • 2:07 PM ──────────────────────┐   │
│  │ Got it. Here's the client-side signing flow... │   │
│  │ Codex is typing...                             │   │
│  └────────────────────────────────────────────────┘   │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [Type a message to interject...]            [Send]  │
└──────────────────────────────────────────────────────┘
```

### Paused State

```
┌──────────────────────────────────────────────────────┐
│  ⚠ CODEX NEEDS YOUR INPUT                           │
│  "Should transaction payloads be constructed         │
│   client-side or server-side?"                       │
├──────────────────────────────────────────────────────┤
│  [transcript above...]                               │
│                                                      │
├──────────────────────────────────────────────────────┤
│  [Respond to Codex...]                       [Send]  │
└──────────────────────────────────────────────────────┘
```

---

## Expected Session Statistics

| Metric                | Typical Planning Session            |
| --------------------- | ----------------------------------- |
| Total turns           | 8-12 (6-10 agent + 1-2 human)       |
| Wall-clock time       | 5-15 minutes                        |
| Per-turn time (agent) | 30-90 seconds                       |
| Human escalations     | 0-2                                 |
| Human interjections   | 0-3                                 |
| Decisions captured    | 5-10                                |
| Files created         | 12-18 (turns + session + artifacts) |
| Total disk usage      | 50-200 KB                           |

---

## CLI Quick Reference

```bash
# Start a planning session (Claude goes first by default)
acb --topic "Plan the auth refactor"

# Codex goes first
acb --topic "Review the API design" --first codex

# Limit to 10 turns
acb --topic "Debug the payment flow" --max-turns 10

# Custom mode (future — v1 is planning only)
acb --topic "Review PR #42" --mode code_review
```
