---
date: 2026-03-23
topic: agent-collab-handoff-to-claude
source: codex
related:
  - .claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md
  - .claude/workflows/brainstorms/2026-03-23-agent-collab-prd-review.md
---

# Handoff to Claude: Agent Collaboration Next Steps

## Current State

The brainstorm has been tightened into a document-handoff architecture for v1. The direction is now:

- local-only
- two agents only
- turn-based
- planning mode only
- CLI-first, no required direct API calls in v1
- orchestrator-managed canonical turn files
- per-session working directory isolation

The updated requirements doc is here:

- `.claude/workflows/brainstorms/2026-03-23-agent-collab-requirements.md`

## What Changed From The Earlier Draft

These points are now explicit in the requirements:

- canonical turn files are owned by the orchestrator, not written directly by the agent as the source of truth
- `AGENTS.md` should live in a per-session runtime directory, not a shared repo root
- human interjections during an active turn are queued and injected at the next turn boundary
- after `needs_human`, control returns to the same agent unless the human explicitly redirects it
- v1 context is bounded: session brief + running summary + recent turns + attachments
- post-session `summary.md` is CLI-synthesized by default, not API-required

## What Needs To Be Tackled Next

### 1. Lock the canonical handoff schema

The requirements now name minimum fields, but the exact schema still needs to be finalized before planning.

Please define:

- required frontmatter fields
- optional frontmatter fields
- allowed `status` values
- whether `needs_human: true` is redundant with `status: needs_human` or whether both should remain
- whether `decisions` is always an array
- whether `response_to` points to turn number, turn id, or file path
- how malformed or partial agent output is represented

Recommended direction:

- keep `response_to` as an id, not a turn number
- keep `decisions` as an array
- use one canonical completion signal: `status`
- keep `needs_human` only if you think it materially improves readability; otherwise `status: needs_human` may be enough

## Proposed v1 schema starter

```yaml
id: turn-0004-codex
turn: 4
from: codex
timestamp: 2026-03-23T07:15:00-06:00
status: complete
response_to: turn-0003-claude
decisions: []
needs_human: false
```

### 2. Lock the session directory and runtime file layout

The doc now proposes:

- `sessions/<id>/turns/`
- `sessions/<id>/artifacts/`
- `sessions/<id>/runtime/`

Please turn that into a concrete layout and say what each file is for.

At minimum, define:

- where `session.md` lives
- where the running summary lives
- where temporary agent outputs go
- where dynamic `AGENTS.md` files go
- whether Claude and Codex share one runtime dir or get separate runtime subdirs

Recommended direction:

- use separate runtime subdirs per agent if prompt files may differ
- keep canonical turn files immutable once written

### 3. Resolve the watcher UI boundary

The requirements intentionally reduced scope, but one boundary is still important:

- file watching can render turns
- file watching alone cannot handle human input submission

Please define the thinnest viable v1 architecture for the watcher UI:

- static page + tiny local HTTP server
- static page + polling JSON endpoint
- fully server-rendered local page
- manual refresh only

Recommended direction:

- tiny local HTTP server
- simple polling over filesystem watching if that is operationally safer on the target machine
- transcript + input box only for v1

### 4. Finalize phase-1 role prompts

The requirements say:

- Claude: architecture/product reasoning
- Codex: implementation feasibility/optimization

Please turn that into actual prompt text for `planning` mode and tighten each role so they do not collapse into polite agreement.

Specifically answer:

- what Claude is responsible for producing
- what Codex is responsible for producing
- what each should challenge the other on
- when either should escalate to the human
- how to avoid repetitive restatement

### 5. Confirm the dynamic `AGENTS.md` operating model

This is still a real implementation concern even though the broad direction is set.

Please reason through:

- whether `codex exec` should run with cwd at `sessions/<id>/runtime/`
- whether `AGENTS.md` should be rewritten before every Codex turn or only when role/session instructions change
- whether Claude needs an analogous file-based system prompt mechanism, or whether its CLI invocation path is enough
- whether concurrent sessions create any hidden prompt leakage risk

Recommended direction:

- assume `AGENTS.md` is read at process start
- write it before each Codex turn for determinism
- keep each session isolated

### 6. Define failure handling at the orchestrator boundary

The revised requirements improved protocol clarity, but failure behavior still needs to be explicit enough for planning.

Please define what the orchestrator does when:

- agent output file is missing
- output file exists but frontmatter is invalid
- output is empty
- CLI exits nonzero
- turn exceeds timeout
- human interjection file is malformed

Recommended direction:

- canonical turn should never be written without validation
- invalid agent output should become a system/error turn or retry path, not silent corruption

## Questions Claude Should Answer Before Planning

Please produce answers or decisions for:

1. Final v1 canonical handoff schema
2. Final v1 session directory layout
3. Final v1 watcher UI architecture boundary
4. Final `planning` role prompts for Claude and Codex
5. Final failure-handling rules at turn boundaries

## What Can Be Deferred To Planning

These do not need to block the start of implementation planning:

- optimizing the context window beyond the current bounded default
- adding token or usage metadata fields
- future `code_review` and `debate` modes
- direct API synthesis path for later versions
- richer UI beyond transcript + interject input

## Codex View

The design is now in a good place structurally. The biggest remaining risk is no longer architecture choice; it is protocol ambiguity. If the schema, runtime layout, UI boundary, and failure behavior are locked, planning should be straightforward.

The most important implementation opinion from my side is this:

- do not let the agent directly author the canonical turn file as the source of truth
- let the agent write temporary output
- let the orchestrator validate and normalize that into the canonical turn file

That one choice will simplify retries, schema evolution, and error handling.

## Requested Claude Output

Please return:

- a short decisions section that resolves the five pre-planning questions above
- proposed v1 handoff frontmatter schema
- proposed v1 session directory tree
- proposed watcher UI/backend shape
- proposed `planning` mode role prompts
- any objections to the current Codex invocation model
