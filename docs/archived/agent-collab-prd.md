# PRD: Agent Collaboration Bus (ACB)
**Version:** 1.0  
**Status:** Draft  
**Author:** Davis  
**Target:** Claude Code implementation

---

## 1. Overview

### 1.1 Problem Statement

Current multi-agent workflows between Claude and Codex are asynchronous and document-centric: one agent produces a handoff file, the other reads it, produces another file, and so on. This creates friction, latency, and a lack of genuine back-and-forth reasoning. Neither agent can ask the other a clarifying question mid-task, challenge an assumption, or collaboratively explore a problem space.

### 1.2 Vision

Build a lightweight **local message bus** that allows Claude (via Claude Code / Claude Desktop MCP) and Codex (via OpenAI API or CLI) to conduct structured, real-time conversations — mediated by a central hub — while a human operator observes the conversation live, can interject at any point, and can be directly escalated to by either agent when they are blocked or disagree.

The system should also produce durable artifacts (planning docs, handoff notes, decision logs) as first-class outputs, not as a replacement for conversation but as a structured record of it.

### 1.3 Non-Goals

- This is not a general-purpose agent orchestration framework (no DAGs, no parallel task execution)
- This is not a cloud/remote system — v1 is local-only (same machine)
- This does not replace Claude Code or Codex's individual coding capabilities — it connects them
- This does not autonomously trigger conversations (v1 is always human-initiated)

---

## 2. Users & Use Cases

### 2.1 Primary User

Solo developer (Davis) running both agents locally, working on projects like kinetic.xyz. Wants to act as a director/observer who sets a topic, watches agents reason together, and steers when needed.

### 2.2 Core Use Cases

**UC-1: Feature Planning Session**
Davis initiates a session with a topic like "Plan the architecture for Phantom wallet deep-link support on mobile." Claude and Codex take turns reasoning, asking each other questions, proposing approaches, and challenging each other's assumptions. Davis watches in real time and can interject. The session ends with a structured planning doc.

**UC-2: Code Review Dialogue**
Davis initiates a session pointing at a specific file or PR diff. Claude reviews for logic/architecture concerns, Codex reviews for implementation and optimization. They surface disagreements to each other (and to Davis) rather than silently overwriting each other's assessments. Output is a review summary doc.

**UC-3: Human Escalation**
Mid-conversation, Codex determines it needs a product decision that neither agent can make. It sends a `NEEDS_HUMAN` message. The UI surfaces this prominently to Davis, pauses the agent turn, and waits for Davis's input before continuing.

---

## 3. System Architecture

### 3.1 Components

```
┌─────────────────────────────────────────────┐
│                  ACB Hub                     │
│  - WebSocket server (ws://localhost:3333)    │
│  - Message router & history store            │
│  - Session manager                           │
│  - Artifact writer                           │
└────────┬──────────────────┬──────────────────┘
         │                  │
    ┌────▼────┐        ┌─────▼────┐
    │ Claude  │        │  Codex   │
    │ Adapter │        │ Adapter  │
    │ (MCP or │        │ (OpenAI  │
    │  Node)  │        │  Node)   │
    └─────────┘        └──────────┘
         │                  │
   Claude Code /       Codex CLI /
   Anthropic API       OpenAI API
         
         
    ┌────────────────────────┐
    │   Observer UI          │
    │   (localhost:3334)     │
    │   - Live transcript    │
    │   - Interject panel    │
    │   - Escalation alerts  │
    │   - Artifact viewer    │
    └────────────────────────┘
```

### 3.2 ACB Hub

A Node.js WebSocket server that is the central nervous system of the system. Responsibilities:

- Accept WebSocket connections from Agent Adapters and Observer UI clients
- Route messages between agents (turn-based by default)
- Maintain full session history in memory and persist to `sessions/<session-id>.jsonl`
- Enforce turn order and timeouts
- Detect and surface `NEEDS_HUMAN` escalations
- Trigger artifact generation at session end (or on demand)

**Tech:** Node.js, `ws` package, Express for REST health/control endpoints.

### 3.3 Agent Adapters

Thin wrapper processes (one per agent) responsible for:

- Connecting to the ACB Hub via WebSocket
- Receiving a message from the hub (containing full conversation history + new message)
- Calling their respective AI API (Anthropic or OpenAI) with the appropriate system prompt + history
- Streaming the response back to the hub token-by-token
- Detecting special tokens in the response (`[NEEDS_HUMAN]`, `[QUESTION_FOR_CODEX]`, `[QUESTION_FOR_CLAUDE]`) and emitting the appropriate message type

**Claude Adapter:** Uses `@anthropic-ai/sdk`, calls `claude-opus-4-5` or `claude-sonnet-4-5`.  
**Codex Adapter:** Spawns the Codex CLI (`codex`) as a child process via Node's `child_process.spawn`. Passes the conversation context via stdin or a temp file, streams stdout back to the hub line-by-line, and handles process exit/error codes.

### 3.4 Observer UI

A local web app (served by the Hub on port 3334) that:

- Shows the live conversation as a chat transcript, labeled by agent
- Streams tokens in real time (no waiting for full agent turns)
- Shows a prominent alert banner when either agent sends `NEEDS_HUMAN`
- Provides a text input for Davis to interject at any time (injects a `HUMAN` turn into the message bus)
- Has a "End Session" button that triggers artifact generation
- Shows generated artifacts inline with a download/copy option

**Tech:** Single-page HTML/JS app, no framework required, connects to Hub via WebSocket.

---

## 4. Message Protocol

All messages are JSON objects sent over WebSocket.

### 4.1 Message Schema

```json
{
  "id": "uuid-v4",
  "session_id": "uuid-v4",
  "timestamp": "ISO-8601",
  "from": "claude" | "codex" | "human" | "system",
  "to": "claude" | "codex" | "human" | "all",
  "type": "turn" | "question" | "needs_human" | "human_response" | "system_event" | "token_stream",
  "content": "string",
  "metadata": {}
}
```

### 4.2 Message Types

| Type | Description |
|---|---|
| `turn` | Standard conversational turn from an agent |
| `question` | Agent explicitly directing a question to the other agent or to human |
| `needs_human` | Agent is blocked; requires human input before proceeding |
| `human_response` | Davis's interjection or response to an escalation |
| `system_event` | Hub lifecycle events (session start, end, timeout, artifact ready) |
| `token_stream` | Streaming token chunk (partial turn, for live UI rendering) |

### 4.3 Special Tokens (In-Band Signals)

Agents can embed structured signals in their natural language responses. The adapter parses these before forwarding:

- `[NEEDS_HUMAN: <reason>]` — triggers escalation
- `[QUESTION FOR CODEX: <question>]` — adapter sets `type: "question"`, `to: "codex"`
- `[QUESTION FOR CLAUDE: <question>]` — adapter sets `type: "question"`, `to: "claude"`
- `[DECISION: <decision text>]` — logged to the decision ledger in the session artifact

---

## 5. Turn Management

### 5.1 Default Flow

1. Davis initiates a session via the Observer UI (sets topic, selects mode, picks which agent goes first)
2. Hub sends `session_start` system event to all adapters and UI
3. Hub sends the topic + system prompt to the first agent adapter
4. Agent responds; response is routed to hub, forwarded to UI (streaming) and queued for the next agent
5. Hub sends the full conversation history + latest message to the second agent
6. Repeat until: session end is triggered, turn limit is hit, or a `needs_human` pause occurs

### 5.2 Turn Limits & Timeouts

- Default max turns: 20 (configurable at session start)
- Per-turn timeout: 90 seconds (configurable)
- If timeout is hit, hub injects a `system_event` informing both agents and the UI

### 5.3 Human Escalation Flow

1. Agent emits `[NEEDS_HUMAN: <reason>]`
2. Adapter sends `needs_human` message to hub
3. Hub pauses turn progression, emits `needs_human` to UI
4. UI shows prominent alert with the reason; Davis's input panel activates
5. Davis types a response; hub sends it as a `human_response` message to both agents
6. Hub resumes turn progression from the agent that escalated

### 5.4 Human Interjection (Non-Escalation)

- Davis can type into the Observer UI at any time
- Hub injects a `human_response` turn into the conversation at the next natural turn boundary (i.e., after the current agent finishes its token stream)
- Both agents receive it in their next context window

---

## 6. Agent System Prompts

Each adapter injects a system prompt that tells the agent its role in this context.

### 6.1 Claude System Prompt Template

```
You are Claude, participating in a structured collaborative session with Codex (an OpenAI agent). 
The human operator (Davis) is watching this conversation in real time and may interject.

Your role in this session: [ROLE — e.g. "architecture and product reasoning"]
Session topic: [TOPIC]

Guidelines:
- Be direct and concise. This is a dialogue, not a monologue.
- Ask Codex clarifying questions when needed using: [QUESTION FOR CODEX: your question]
- If you need a decision from Davis that neither agent can make, use: [NEEDS_HUMAN: reason]
- When you reach a notable decision or conclusion, signal it with: [DECISION: summary]
- Do not repeat what was already said. Build on it.
- Disagree openly when you have a better approach. Explain why concisely.
```

### 6.2 Codex System Prompt Template

```
You are Codex, participating in a structured collaborative session with Claude (an Anthropic agent).
The human operator (Davis) is watching this conversation in real time and may interject.

Your role in this session: [ROLE — e.g. "implementation feasibility and code strategy"]
Session topic: [TOPIC]

Guidelines:
- Be direct and concise. This is a dialogue, not a monologue.
- Ask Claude clarifying questions when needed using: [QUESTION FOR CLAUDE: your question]
- If you need a decision from Davis that neither agent can make, use: [NEEDS_HUMAN: reason]
- When you reach a notable decision or conclusion, signal it with: [DECISION: summary]
- Do not repeat what was already said. Build on it.
- Disagree openly when you have a better approach. Explain why concisely.
```

---

## 7. Session Modes

Selectable at session initiation:

| Mode | Description | Default Turn Order |
|---|---|---|
| `planning` | Open-ended brainstorming / feature planning | Claude → Codex → ... |
| `code_review` | Review of a specific file, diff, or PR | Codex → Claude → ... |
| `debate` | Structured exploration of two competing approaches | Alternating |

Each mode also affects the artifact template generated at session end (see Section 8).

---

## 8. Artifacts

At session end (or on-demand), the Hub generates structured markdown artifacts saved to `sessions/<session-id>/`.

### 8.1 Artifact Types

**`transcript.md`** — Full conversation log, formatted with speaker labels, timestamps, and turn numbers. Always generated.

**`decisions.md`** — All `[DECISION: ...]` signals extracted from the conversation, in order. Useful as a quick reference for what was agreed.

**`plan.md`** *(planning mode only)* — Hub uses a post-processing Claude API call to synthesize the conversation into a structured plan: background, goals, proposed approach, open questions, next steps.

**`review.md`** *(code_review mode only)* — Synthesized code review: summary of concerns raised by each agent, agreed action items, unresolved disagreements.

**`handoff.md`** — A general-purpose handoff doc. Brief summary of the session, key decisions, and what the next human/agent action should be. Always generated.

### 8.2 Artifact Generation

Post-processing artifacts (`plan.md`, `review.md`) are generated by making a single Anthropic API call with the full transcript as context and a synthesis prompt. This happens after the session ends and takes ~10-20 seconds. The Observer UI shows a "Generating artifacts..." indicator and renders them inline when ready.

---

## 9. Configuration

A single `acb.config.json` at the project root:

```json
{
  "hub": {
    "port": 3333,
    "ui_port": 3334
  },
  "claude": {
    "model": "claude-sonnet-4-5",
    "api_key_env": "ANTHROPIC_API_KEY"
  },
  "codex": {
    "cli_path": "codex",
    "model": "o3",
    "api_key_env": "OPENAI_API_KEY",
    "approval_mode": "full-auto"
  },
  "sessions": {
    "output_dir": "./sessions",
    "default_max_turns": 20,
    "turn_timeout_seconds": 90
  }
}
```

API keys are read from environment variables, never stored in config.

---

## 10. Project Structure

```
acb/
├── acb.config.json
├── package.json
├── hub/
│   ├── index.js          # WebSocket server, message router
│   ├── session.js        # Session state management
│   ├── artifacts.js      # Artifact generation logic
│   └── ui/
│       └── index.html    # Observer UI (single file)
├── adapters/
│   ├── claude.js         # Claude adapter process
│   └── codex.js          # Codex adapter process
├── scripts/
│   └── start.js          # Starts hub + both adapters
└── sessions/             # Generated session output (gitignored)
```

---

## 11. CLI / Launch Interface

```bash
# Install
npm install

# Start the hub and both adapters
node scripts/start.js

# Open Observer UI
open http://localhost:3334

# Or initiate a session directly from CLI (opens UI automatically)
node scripts/start.js --topic "Plan Phantom wallet deep-link support" --mode planning
```

---

## 12. Observer UI — Key Screens

### 12.1 Session Setup Screen
- Topic text input (required)
- Mode selector (planning / code_review / debate)
- Max turns slider (5–50)
- "Who goes first" toggle (Claude / Codex)
- Optional: attach a file or paste code context
- "Start Session" button

### 12.2 Live Conversation Screen
- Chat transcript view, messages labeled `[CLAUDE]`, `[CODEX]`, `[DAVIS]`, `[SYSTEM]`
- Streaming tokens render in real time (typewriter effect)
- Sidebar: session metadata, turn counter, mode
- Prominent yellow `⚠ NEEDS HUMAN INPUT` banner when escalation occurs, with the agent's stated reason and a response input
- Davis interject panel: always-visible text input + "Send" button at the bottom
- "End Session" button (top right)

### 12.3 Artifacts Screen (post-session)
- Generated artifact tabs: Transcript, Decisions, Plan/Review, Handoff
- Rendered markdown viewer
- "Copy" and "Download" buttons per artifact

---

## 13. Implementation Phases

### Phase 1 — Core Bus (MVP)
- Hub WebSocket server with message routing and session history
- Claude adapter (Anthropic API, streaming)
- Codex adapter (OpenAI API, streaming)
- Basic Observer UI: live transcript + interject input
- `transcript.md` and `handoff.md` artifact generation
- `planning` mode only

### Phase 2 — Human-in-the-Loop
- `NEEDS_HUMAN` escalation detection and UI alert
- Human response injection into turn flow
- `decisions.md` artifact from `[DECISION: ...]` extraction

### Phase 3 — Modes & Rich Artifacts
- `code_review` and `debate` modes
- File/diff attachment at session start
- `plan.md` and `review.md` post-processing artifacts
- Artifact viewer in UI

### Phase 4 — Polish
- Turn timeout handling
- Config file hot-reload
- Session history browser (view past sessions)
- Export to Google Docs / Notion (stretch)

---

## 14. Open Questions

1. **Codex CLI subprocess interface:** The Codex adapter will spawn `codex` as a child process. Need to confirm the exact flags for: passing a system prompt, feeding conversation history (stdin vs. `--instructions` flag vs. temp file), running in non-interactive/pipe mode, and whether `--approval-mode full-auto` is the right flag to suppress interactive prompts during a session.
2. **Claude Code integration:** Should the Claude adapter hook into Claude Code's MCP interface, or call the Anthropic API directly? Direct API is simpler for v1; MCP would let Claude have file system access during the conversation.
3. **Context window management:** For long sessions, full history may approach context limits. Decide on truncation strategy (sliding window vs. summarization) before Phase 3.
4. **File attachment format:** For code review mode, decide whether to attach file contents inline in the system prompt or as a separate `document` block (Anthropic) / `file` object (OpenAI).
