---
date: 2026-03-23
topic: agent-collab-prd-review
---

# Agent Collaboration Bus PRD — Review Findings

Review of `docs/agent-collab-prd.md` (v1.0 Draft). Organized by severity: critical gaps first, then structural improvements, then polish.

---

## Critical Gaps

### 1. Codex CLI Is Not Designed for Programmatic Subprocess Use

The PRD assumes (Section 3.3, Open Question #1) that the Codex CLI can be spawned as a child process, fed conversation history via stdin, and have its stdout parsed for structured responses. This is the **highest-risk assumption in the entire PRD**.

The Codex CLI is an interactive terminal tool. It was not built for pipe mode. Known issues:
- **No documented stdin/pipe mode** — Codex expects an interactive terminal. Spawning it via `child_process.spawn` and writing to stdin is fragile at best.
- **Output is not structured** — stdout includes terminal formatting, spinners, status messages, and ANSI escape codes. Parsing for clean agent responses is unreliable.
- **No conversation history injection** — There is no `--history` flag or equivalent. The `--instructions` flag sets a system prompt but does not carry multi-turn context.
- **Process lifecycle issues** — Codex may spawn its own subprocesses (sandboxed code execution), making clean shutdown and turn-boundary detection difficult.

**Recommendation:** Replace the Codex CLI subprocess approach with **direct OpenAI API calls** (using the `openai` Node SDK), mirroring how the Claude adapter works. This makes both adapters symmetric, eliminates the fragility, and gives you full control over conversation history, streaming, and system prompts. The PRD already lists `o3` as the model — just call it directly. The Codex CLI's value is its interactive UX and sandboxed code execution, neither of which you need here.

### 2. No Error Handling or Resilience Model

The PRD describes only the happy path. Missing:
- **What happens when an API call fails?** (rate limit, network error, 500) No retry strategy, no user notification, no graceful degradation.
- **What happens when an adapter process crashes?** The hub has no reconnection logic or health-check mechanism.
- **What happens when a WebSocket connection drops?** The Observer UI has no reconnection or "connection lost" state.
- **What happens when token streaming stalls?** The 90-second timeout covers full turns, but a stream that emits one token per minute would never trigger it.

**Recommendation:** Add a "Failure Modes" section covering at minimum: API errors (retry with backoff, surface to UI after N failures), adapter crashes (hub detects disconnect, notifies UI, offers restart), WebSocket reconnection (auto-reconnect with exponential backoff in UI client), and stalled streams (inactivity timeout separate from turn timeout).

### 3. Context Window Management Is Deferred but Is a Phase 1 Blocker

Open Question #3 defers context window management to "before Phase 3." But the default is 20 turns with two agents and potential human interjections. At ~2000 tokens per turn, that's 40K+ tokens of history alone, plus system prompts and any attached code. Claude's context is large, but OpenAI models vary — and the full history is resent on every turn.

**Recommendation:** Define a simple strategy for Phase 1 (even if it's "truncate to last N turns with a summary preamble") so you don't hit silent failures during MVP testing.

---

## Structural Improvements

### 4. In-Band Special Tokens Are Fragile

Section 4.3 relies on agents embedding `[NEEDS_HUMAN: ...]`, `[QUESTION FOR CODEX: ...]`, etc. in their natural language output. Problems:
- **LLMs do not reliably produce exact bracket syntax**, especially under varied prompting conditions. They may omit brackets, change casing, add extra spaces, or paraphrase the signal.
- **False positives** — an agent discussing the protocol itself could trigger parsing (e.g., "I would use `[NEEDS_HUMAN: ...]` when...").
- **Parsing complexity** — extracting these from a streaming token-by-token response requires buffering and bracket-matching logic that is error-prone.

**Recommendation:** Consider a two-track approach:
1. Keep in-band tokens as a hint mechanism, but with fuzzy matching (regex with optional spaces/casing).
2. Add a structured **tool-use / function-calling** layer. Both Anthropic and OpenAI APIs support tool use natively. Define tools like `escalate_to_human(reason)`, `ask_agent(target, question)`, `log_decision(summary)`. The API will return these as structured objects, not embedded text. This is far more reliable and is how both APIs are designed to be used for structured agent actions.

### 5. Message Protocol Missing Key Fields

The message schema (Section 4.1) is missing:
- **`turn_number`** — essential for ordering, especially with concurrent streams and human interjections.
- **`parent_id` or `in_reply_to`** — needed to thread questions and responses (e.g., linking a `human_response` to the `needs_human` that triggered it).
- **`status`** — for `token_stream` messages, there's no way to signal "stream started" vs "stream ended." The UI and hub need to know when a turn is complete.
- **`error`** — no way to represent an error message (API failure, timeout) in the protocol.
- **Token count / usage metadata** — useful for context window tracking (ties to gap #3).

### 6. Turn Management Has Unspecified Edge Cases

- **Concurrent human interjection during agent turn:** Section 5.4 says interjections are injected "at the next natural turn boundary." But what if Davis sends 3 messages while an agent is streaming? Are they batched? Queued? Last-one-wins?
- **Escalation during the other agent's turn:** If Claude escalates but Codex is already mid-response, who pauses?
- **Turn order after human response:** After a `needs_human` → `human_response` cycle, Section 5.3 says "resume from the agent that escalated." But what if the human's response changes the direction and the *other* agent should respond?
- **Empty/refused turns:** What if an agent returns an empty response or refuses to engage? No retry or fallback logic.

### 7. Security Surface Is Unaddressed

- **WebSocket server on localhost:3333 is open to any local process.** Any local app or browser tab could connect and inject messages. Consider a simple session token or shared secret for WebSocket auth.
- **Observer UI on localhost:3334 serves an HTML page.** If the UI makes WebSocket connections, CORS and origin checking matter. A malicious browser tab on the same machine could connect.
- **API keys in environment variables** is good, but the config references them by name — ensure the config file itself never gets committed with keys. Add `acb.config.json` to `.gitignore` or use a `.env` approach.

### 8. Observer UI "No Framework" May Be Undersized

Section 3.4 says "Single-page HTML/JS app, no framework required." But the UI requirements include:
- Real-time streaming WebSocket rendering (typewriter effect)
- Multiple screens (setup, live conversation, artifacts)
- Alert banners, sidebar metadata, markdown rendering
- Tab-based artifact viewer with copy/download

This is a non-trivial frontend. A single HTML file will become unwieldy quickly.

**Recommendation:** Either (a) use a lightweight framework like Preact or Alpine.js to keep it manageable, or (b) scope the Phase 1 UI down to *just* the live transcript + input box, and add screens/tabs in later phases.

---

## Missing Product Decisions

### 9. No Success Criteria or Metrics

The PRD describes what to build but not how to know if it works well. Consider adding:
- What does a "successful session" look like? (e.g., agents produce a plan that Davis uses without major revision)
- What are the failure modes from a *product* perspective? (e.g., agents talk past each other, sessions devolve into repetition)
- How will you know if the turn-based model is too rigid or too loose?

### 10. No Guidance on Agent Roles / Differentiation

Section 6 provides system prompt templates, but the PRD doesn't define *what each agent is actually better at* or how to ensure they don't just produce redundant outputs. If both agents have similar capabilities, conversations may devolve into two agents agreeing politely.

**Recommendation:** Define clear role differentiation per mode. E.g., in planning mode: Claude owns architecture/product reasoning, Codex owns implementation feasibility and cost estimation. In code review: Claude focuses on design/logic, Codex focuses on performance/edge cases. The system prompts should be more prescriptive about what each agent is *responsible for producing* in each mode.

### 11. Debate Mode Is Underspecified

Section 7 lists `debate` as a session mode with "alternating" turn order, but:
- How are the two positions assigned? Does Davis specify them, or do agents self-select?
- Is there a structured format (opening → rebuttal → closing)?
- What artifact does this produce?
- How does it differ from `planning` mode with a disagreement?

---

## Minor / Polish Issues

### 12. Model Names Are Outdated

Section 3.3 references `claude-opus-4-5` and `claude-sonnet-4-5`. The current model IDs are `claude-opus-4-6` and `claude-sonnet-4-6`. Config default (Section 9) uses `claude-sonnet-4-5`. Update to current model IDs and consider making this easy to update as new models ship.

### 13. Artifact Post-Processing Creates a Billing Spike

Section 8.2 says artifacts like `plan.md` are generated by a separate Anthropic API call with the "full transcript as context." For a 20-turn session, this could be a large prompt. Consider:
- Estimating the cost per session
- Whether the synthesis could use a cheaper/faster model (Haiku)
- Whether incremental summarization during the session would be better than one large post-hoc call

### 14. Session Persistence Format

Sessions are stored as `.jsonl` (Section 3.2) but artifacts are `.md` in a subdirectory (Section 8). The relationship between `sessions/<id>.jsonl` and `sessions/<id>/transcript.md` is ambiguous. Clarify the directory structure.

### 15. No Versioning or Migration Path

The message protocol and config format have no version field. If the schema changes between phases, existing session files and configs will break silently.

---

## Summary of Recommendations (Priority Order)

| # | Finding | Action |
|---|---------|--------|
| 1 | Codex CLI subprocess assumption | Switch to direct OpenAI API calls |
| 4 | In-band special tokens fragility | Use native tool/function-calling APIs |
| 2 | No error handling model | Add "Failure Modes" section |
| 3 | Context window deferred too long | Define Phase 1 truncation strategy |
| 5 | Message protocol gaps | Add turn_number, parent_id, status, error fields |
| 6 | Turn management edge cases | Specify behavior for concurrent/edge scenarios |
| 10 | Agent role differentiation | Prescriptive role definitions per mode |
| 8 | Observer UI scope vs "no framework" | Either add lightweight framework or reduce Phase 1 UI scope |
| 9 | No success criteria | Add measurable success criteria |
| 7 | Security surface | Add WebSocket auth, origin checking |
| 11 | Debate mode underspecified | Define structure or defer to Phase 3 explicitly |
| 12 | Outdated model names | Update to current model IDs |

## Next Steps

`-> /ce:brainstorm` to discuss which recommendations to adopt before updating the PRD, then `/ce:plan` for implementation planning.
