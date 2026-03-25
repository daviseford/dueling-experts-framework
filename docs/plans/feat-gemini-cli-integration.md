# Gemini CLI Integration Plan

> **Status:** Planned (blocked on `feat-pluggable-providers`)
> **Scope:** Gemini as a third provider in a two-agent system. Three-or-more agent debates are explicitly out of scope.
> **Delivery:** Built-in provider first; plugin support deferred until the provider API stabilizes.

## Overview

Integrate [Gemini CLI](https://github.com/google-gemini/gemini-cli) as a third agent provider in DEF, alongside Claude and Codex. Gemini can serve as either the plan debater or the reviewer in any two-agent pairing (e.g., Claude + Gemini, Codex + Gemini).

This plan is **blocked** until `feat-pluggable-providers` ships. The current codebase hardcodes a two-provider assumption in multiple files (see [Prerequisites](#phase-0-prerequisites)).

---

## Scope Constraints

- **Two-agent system only.** Every DEF session uses exactly two agents. Gemini is a third *provider*, not a third *participant*. Three-agent debates are out of scope for this feature and for DEF's foreseeable roadmap.
- **Built-in first.** Gemini ships as a built-in provider in `src/providers/gemini.ts` alongside Claude and Codex. External plugin loading (`--provider ./gemini.js`) is deferred until the provider API has stabilized through real usage.
- **No default sandbox.** Docker/Podman sandbox is opt-in and deferred to Phase 5 (hardening). It will not be required for the MVP path.

---

## Provider API Prerequisites (Phase 0 Gate)

The `feat-pluggable-providers` refactor **must** deliver all eight of these before any Gemini branch starts. Each maps to a specific hardcoded assumption in the current code.

| # | Prerequisite | Current Hardcoding | Required Change |
|---|---|---|---|
| 1 | Dynamic other-agent resolution | `src/orchestrator.ts:377` — `nextAgent === 'claude' ? 'codex' : 'claude'` | Orchestrator resolves the "other" agent from the session's two-provider config, not a ternary |
| 2 | Provider-owned fast model mapping | `src/agent.ts:30-33` — `FAST_MODELS` keyed by `AgentName` | Each provider declares its own `fastModel` field |
| 3 | Provider-owned phase arg construction | `src/agent.ts:35-68` — `AGENTS` record with hardcoded CLI args | Each provider builds its own `args`, `implementArgs`, `reviewArgs` |
| 4 | Provider-owned review tool policy | Claude uses `--allowedTools 'Bash(gh:*)'`, Codex uses `--full-auto` | `reviewTools: 'none' \| 'scoped' \| 'full'` field on the provider interface |
| 5 | Provider-owned prompt hints + response normalization | Prompts in `src/context.ts:30-44` reference agents by name | `promptHints(phase)` and `parseResponse(raw)` hooks on provider |
| 6 | Split preflight checks | No preflight exists today | `preflightInstall()` and `preflightConfig()` methods on provider |
| 7 | Provider-owned execution limits | `src/agent.ts:26-28` — global `TIMEOUT_MS`, `MAX_OUTPUT_BYTES` | `timeoutMs` and `maxOutputBytes` fields on provider |
| 8 | Per-agent consensus tracking | `src/orchestrator.ts:129-130` — `claudeEverDecided`, `codexEverDecided` | `Map<AgentName, boolean>` replacing named booleans |

---

## Provider Interface

The provider interface that `feat-pluggable-providers` must define, shaped by the decisions in this plan:

```typescript
interface Provider {
  name: AgentName;
  cmd: string;

  // Phase-specific argument construction
  args(phase: SessionPhase, outputPath: string): string[];
  implementArgs(): string[];
  reviewArgs(): string[];

  // Execution limits (provider-specific)
  timeoutMs: { plan: number; implement: number; review: number };
  maxOutputBytes: number;

  // Fast-tier model (for validation retry escalation heuristic)
  fastModel: string;

  // Review tool policy — explicit, not inferred from TTY state
  reviewTools: 'none' | 'scoped' | 'full';

  // Output capture strategy
  captureStdout: boolean;

  // Preflight — split into install + config, no live model calls
  preflightInstall(): Promise<{ ok: boolean; error?: string }>;
  preflightConfig(): Promise<{ ok: boolean; error?: string }>;

  // Prompt hints — model-specific instructions injected at prompt assembly
  // Returns additional prompt text for the given phase, or empty string
  promptHints(phase: SessionPhase): string;

  // Response normalization — runs before validation
  // Strips wrapper text, normalizes format, returns cleaned string
  // Must return string (not a richer type) for the initial rollout
  parseResponse(raw: string): string;
}
```

### Key Design Decisions

**`reviewTools` is explicit policy, not a TTY side effect.** The Gemini CLI has no scoped tool mode — only `--yolo` (approve everything) or interactive approval (blocks on non-TTY stdin). Rather than relying on stdin-pipe failure to produce tool-less behavior, the provider declares `reviewTools: 'none'` explicitly. The orchestrator reads this field to set expectations for review-phase behavior. This is testable without mocking TTY state.

**`promptHints(phase)` replaces a narrow `formatInstructions` string.** Different models need different guidance at different phases. Gemini may need extra YAML frontmatter examples during plan phase and explicit verdict format instructions during review phase. The hook returns phase-appropriate prompt text that gets injected during `src/context.ts` assembly.

**`parseResponse(raw)` is a string-returning normalization hook.** It strips wrapper text, handles JSON-to-frontmatter conversion if needed, and returns cleaned markdown. For the initial Gemini rollout, this stays as `string → string`. A richer return type (e.g., with confidence metadata) is deferred — the existing validation retry path at `src/orchestrator.ts:282-293` already handles unreliable output.

**Preflight is split into install + config checks.** No live model calls during preflight. The original `gemini --prompt "ping"` approach was rejected because it conflates installation, auth, model availability, network health, and billing into one gate, making session start brittle for reasons unrelated to DEF.

- `preflightInstall()`: checks `gemini --version` — binary exists, version is readable
- `preflightConfig()`: checks `GEMINI_API_KEY` env var or `gcloud auth print-access-token` — credentials are present

Runtime auth/model errors are handled by the normal error path on first real invocation.

---

## Gemini Provider Implementation

```typescript
const geminiProvider: Provider = {
  name: 'gemini',
  cmd: 'gemini',

  args(phase, _outputPath) {
    // Base args for non-interactive stdin-piped invocation
    if (phase === 'implement') return this.implementArgs();
    if (phase === 'review') return this.reviewArgs();
    return ['--prompt', '-'];  // Read from stdin
  },

  implementArgs() {
    return ['--yolo', '--prompt', '-'];  // Full tool access for implementation
  },

  reviewArgs() {
    // Explicit: no --yolo, no tools. Diff is in the prompt.
    return ['--prompt', '-'];
  },

  timeoutMs: {
    plan: 300_000,       // 5 min (same as current default)
    implement: 900_000,  // 15 min (same as current default)
    review: 300_000,     // 5 min
  },
  maxOutputBytes: 5 * 1024 * 1024,  // 5 MB

  fastModel: 'gemini-2.0-flash',

  reviewTools: 'none',  // Explicit: no tools in review phase for MVP

  captureStdout: true,

  async preflightInstall() {
    // Check that gemini CLI binary is installed and responsive
    // gemini --version should return a version string
    try {
      // Implementation: spawn('gemini', ['--version']) and check exit code
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Gemini CLI not found: ${err}` };
    }
  },

  async preflightConfig() {
    // Check that credentials are available (env var or gcloud auth)
    if (process.env.GEMINI_API_KEY) return { ok: true };
    try {
      // Implementation: spawn('gcloud', ['auth', 'print-access-token'])
      return { ok: true };
    } catch {
      return { ok: false, error: 'No GEMINI_API_KEY and gcloud auth unavailable' };
    }
  },

  promptHints(phase) {
    const base = [
      'IMPORTANT: Your response MUST start with exactly "---" on its own line (YAML frontmatter delimiter).',
      'Do NOT output any text before the opening "---".',
      'The frontmatter block must contain: id, turn, from, timestamp, status.',
      'Close the frontmatter with another "---" on its own line, then write your markdown response.',
    ].join('\n');

    if (phase === 'review') {
      return base + '\n' + [
        'When reviewing, you MUST include a verdict field in the frontmatter.',
        'verdict must be exactly "approve" or "fix" (lowercase, no quotes in YAML).',
        'Example review frontmatter:',
        '---',
        'id: turn-0005-gemini',
        'turn: 5',
        'from: gemini',
        'timestamp: "2026-01-15T10:00:00Z"',
        'status: decided',
        'verdict: approve',
        '---',
      ].join('\n');
    }

    if (phase === 'plan') {
      return base + '\n' + [
        'If listing decisions, use the decisions field as a YAML array:',
        'decisions:',
        '  - "First decision"',
        '  - "Second decision"',
      ].join('\n');
    }

    return base;
  },

  parseResponse(raw) {
    // Strip common Gemini wrapper patterns:
    // 1. Leading "```yaml" or "```markdown" fences around frontmatter
    // 2. Trailing "```" after the response
    // 3. Any preamble text before the first "---"
    let cleaned = raw;

    // Remove code fences wrapping the entire response
    cleaned = cleaned.replace(/^```(?:yaml|markdown|md)?\s*\n/m, '');
    cleaned = cleaned.replace(/\n```\s*$/m, '');

    // The existing extractFrontmatterBlock in src/validation.ts handles
    // preamble stripping, so we just do format-level cleanup here.

    return cleaned;
  },
};
```

---

## Rollout Phases

### Phase 0: Prerequisites

**Gate:** All eight provider API prerequisites (above) must be met.

**Parallel research (can start before `feat-pluggable-providers` lands):**
- Prototype Gemini prompt wording for all three phases (plan, implement, review)
- Build validation fixtures: collect sample Gemini CLI outputs and test them against `src/validation.ts`
- Document Gemini CLI quirks: `--prompt` behavior, stdin handling, `--yolo` scope, exit codes, stderr patterns
- Test frontmatter compliance: run manual prompts through Gemini and measure YAML parse success rate

**Deliverable:** Research notes and fixture files. No code changes to DEF core.

### Phase 1: Plan Debates (Gemini as debater)

- Extend `AgentName` union type: `'claude' | 'codex' | 'gemini'` (`src/session.ts:11`)
- Update `VALID_FROM` regex in `src/validation.ts:32` to include `gemini`
- Update `VALID_AGENTS` in `src/index.ts:11` to include `'gemini'` (gates `--first` and `--impl-model` CLI validation)
- Add `gemini: 'Gemini'` to `AGENT_NAMES` in `src/context.ts:22`
- Register Gemini as a built-in provider in `src/providers/gemini.ts`
- Wire `promptHints('plan')` into `src/context.ts` prompt assembly
- Wire `parseResponse()` into the validation pipeline (before `validate()` call)
- Implement `preflightInstall()` and `preflightConfig()` checks
- Allow `--agents claude,gemini` or `--agents codex,gemini` session configuration
- Test: full plan-phase debate between Claude and Gemini

**Deliverable:** Gemini can participate in plan debates. No implement or review support yet.

### Phase 2: Implementation Support

- Wire `implementArgs()` — Gemini runs with `--yolo` for full tool access
- Wire provider-specific `timeoutMs` and `maxOutputBytes` into the invocation path
- Test: Gemini implements decisions from a Claude+Gemini plan debate

**Deliverable:** Gemini can implement decisions with full tool access.

### Phase 3: Review Support

- Wire `reviewArgs()` — explicit tool-less review
- Assert `reviewTools: 'none'` is respected by the orchestrator
- Wire `promptHints('review')` with verdict-specific instructions
- Test: Gemini reviews a Claude implementation; Claude reviews a Gemini implementation

**Deliverable:** Full plan-implement-review cycle with Gemini in either role.

### Phase 4: Validation Hardening

- Tune `parseResponse()` based on real failure patterns from Phase 1-3
- Add Gemini-specific validation fixtures to the test suite
- Measure and document retry/escalation rates for Gemini vs Claude/Codex

**Deliverable:** Gemini integration is reliable enough for regular use.

### Phase 5: Hardening & Sandbox (Deferred)

- **Sandbox support (opt-in):** `--sandbox --yolo` for containerized tool access during review
- **Plugin extraction:** If the provider API has stabilized, extract provider definitions into loadable modules
- **Custom MCP server:** Long-term option for scoped Gemini tool access (e.g., read-only `gh` commands)

**Deliverable:** Production-hardened Gemini integration with optional safety rails.

---

## Gemini CLI Mapping

| DEF Concept | Gemini CLI Flag | Notes |
|---|---|---|
| Non-interactive mode | `--prompt -` (stdin) | Reads prompt from stdin pipe |
| Full tool access | `--yolo` | Approves all tool calls automatically |
| Tool-less mode | (omit `--yolo`) | No interactive approval possible via stdin pipe; `reviewTools: 'none'` makes this explicit |
| Sandbox mode | `--sandbox` | Docker/Podman isolation (Phase 5, opt-in) |
| Model selection | `--model <name>` | e.g., `gemini-2.0-flash` for fast tier |
| Output | stdout | `captureStdout: true` |

---

## Validation Considerations

Gemini's `promptHints()` must cover both:

1. **Generic YAML frontmatter compliance** — the `---` delimiters, required fields (`id`, `turn`, `from`, `timestamp`, `status`), and `decisions` array format enforced by `src/validation.ts`
2. **Review-phase verdict semantics** — the `verdict: approve | fix` field required when `status: decided`, validated by `VALID_VERDICT` in `src/validation.ts:33`

The existing validation retry path (`src/orchestrator.ts:282-293`) provides a safety net: if the fast model produces invalid frontmatter, the orchestrator escalates to the full model. This same path works for Gemini — a failed parse triggers retry with the same provider at full tier.

---

## Code Locations Affected

These files will need changes when the integration is implemented:

| File | Change | Phase |
|---|---|---|
| `src/session.ts:11` | Extend `AgentName` union: `'claude' \| 'codex' \| 'gemini'` | 1 |
| `src/validation.ts:32` | Update `VALID_FROM` regex to include `gemini` | 1 |
| `src/index.ts:11` | Add `'gemini'` to `VALID_AGENTS` array (gates `--first` and `--impl-model` CLI validation) | 1 |
| `src/context.ts:22` | Add `gemini: 'Gemini'` to `AGENT_NAMES` | 1 |
| `src/context.ts:30-44` | Inject `provider.promptHints(phase)` into prompt assembly | 1 |
| `src/agent.ts` | Replace `AGENTS` record with provider registry lookups | 0 (prereq) |
| `src/orchestrator.ts:129-131` | Replace named booleans with `Map<AgentName, boolean>` | 0 (prereq) |
| `src/orchestrator.ts:377` | Replace ternary with dynamic other-agent resolution | 0 (prereq) |
| New: `src/providers/gemini.ts` | Gemini provider implementation | 1 |

---

## Decided Questions

These were debated and resolved during planning:

1. **Can we do Gemini work in parallel with the provider refactor?**
   *Yes — research only.* Prompt prototyping, validation fixtures, and CLI quirk documentation can proceed in parallel. No code changes to DEF core until all eight prerequisites land.

2. **Is tool-less review viable for MVP?**
   *Yes.* The review prompt already includes the full diff. The reviewer's job is to assess the diff against decisions, not to run additional commands. `reviewTools: 'none'` is the explicit, testable contract.

3. **Built-in or plugin?**
   *Built-in first.* The provider API is still being invented. Plugin support adds a loading/versioning surface before we know the right abstraction. Ship built-in, stabilize, then extract if there's demand.

4. **Should `parseResponse` return a richer type?**
   *No — string for now.* The validation retry path already handles unreliable output. Adding confidence metadata creates a second decision channel before we know we need it.

---

## Open Work (Not Decided Here)

- Exact Gemini CLI flags for stdin mode may change as the Gemini CLI evolves — verify against current docs before Phase 1
- Fast model name (`gemini-2.0-flash`) will need updating as Gemini releases new models
- Whether Gemini should be the default `impl_model` for any pairing (probably not initially)
