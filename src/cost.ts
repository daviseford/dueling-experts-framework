// ── Cost and usage observability ────────────────────────────────────

/** Token usage from a single agent invocation. */
export interface TokenUsage {
  input_tokens: number | null;
  output_tokens: number | null;
}

/** Per-model pricing rate. */
export interface ModelRate {
  input_per_1k: number;   // USD per 1K input tokens
  output_per_1k: number;  // USD per 1K output tokens
}

// ── Default rates ──────────────────────────────────────────────────
// Approximate rates based on published pricing. Updated with each DEF release.
// Users can override via DEF_MODEL_RATES env var or .def/rates.json.

const DEFAULT_RATES: Record<string, ModelRate> = {
  'opus':                { input_per_1k: 0.015,  output_per_1k: 0.075 },
  'sonnet':              { input_per_1k: 0.003,  output_per_1k: 0.015 },
  'haiku':               { input_per_1k: 0.0008, output_per_1k: 0.004 },
  'gpt-5.4':             { input_per_1k: 0.010,  output_per_1k: 0.040 },
  'gpt-5.1-codex-mini':  { input_per_1k: 0.002,  output_per_1k: 0.008 },
};

/**
 * Load rate configuration.
 * Priority: DEF_MODEL_RATES env var > built-in defaults.
 * Config file support (.def/rates.json) is a future enhancement.
 */
export function loadRates(): Record<string, ModelRate> {
  const envRates = process.env.DEF_MODEL_RATES;
  if (envRates) {
    try {
      const parsed = JSON.parse(envRates) as Record<string, ModelRate>;
      return { ...DEFAULT_RATES, ...parsed };
    } catch {
      // Invalid JSON in env var -- fall back to defaults
    }
  }
  return { ...DEFAULT_RATES };
}

/**
 * Estimate the cost of an invocation given a model name and token usage.
 * Returns null if the model's rate is unknown or token data is missing.
 */
export function estimateCost(modelName: string, usage: TokenUsage): number | null {
  const rates = loadRates();
  const rate = rates[modelName];
  if (!rate || usage.input_tokens === null) return null;
  const inputCost = (usage.input_tokens / 1000) * rate.input_per_1k;
  const outputCost = ((usage.output_tokens ?? 0) / 1000) * rate.output_per_1k;
  return Math.round((inputCost + outputCost) * 10000) / 10000; // 4 decimal places
}

/**
 * Merge two TokenUsage records by summing their token counts.
 * Used to accumulate usage across retries within a single turn.
 * Returns undefined if both inputs are undefined.
 * Preserves null semantics: a field stays null only when BOTH sides are null
 * (meaning "unknown"). If at least one side has a value, the unknown side
 * is treated as 0 for summation.
 */
export function mergeUsage(a: TokenUsage | undefined, b: TokenUsage | undefined): TokenUsage | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  return {
    input_tokens: a.input_tokens === null && b.input_tokens === null
      ? null
      : (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
    output_tokens: a.output_tokens === null && b.output_tokens === null
      ? null
      : (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  };
}

// ── Turn-level usage accumulator ───────────────────────────────────

/**
 * Accumulates token usage across multiple invocations within a single turn.
 * The orchestrator creates one tracker per turn and calls record() after each
 * invocation (initial, validation retry, verdict retry). finalize() attaches
 * the accumulated totals to the canonical turn data.
 *
 * Exported so that tests can exercise the exact same code path the orchestrator uses.
 */
export class TurnCostTracker {
  private _usage: TokenUsage | undefined;

  /** Record usage from an invocation result. */
  record(result: { usage?: TokenUsage }): void {
    this._usage = mergeUsage(this._usage, result.usage);
  }

  /**
   * Attach accumulated usage to canonical turn data.
   * Sets tokens_in, tokens_out, and cost_usd fields.
   * No-op if no usage was recorded.
   */
  finalize(data: { model_name?: string; tokens_in?: number | null; tokens_out?: number | null; cost_usd?: number | null }): void {
    if (!this._usage) return;
    data.tokens_in = this._usage.input_tokens ?? null;
    data.tokens_out = this._usage.output_tokens ?? null;
    data.cost_usd = data.model_name ? estimateCost(data.model_name, this._usage) : null;
  }

  /** Get accumulated usage (read-only, for inspection/testing). */
  get usage(): TokenUsage | undefined {
    return this._usage;
  }
}

// ── Provider-specific token parsers ────────────────────────────────

/**
 * Parse token usage from Claude CLI stderr output.
 * Claude CLI prints a usage summary line to stderr like:
 *   Input tokens: 12345, Output tokens: 6789
 * or in JSON output mode, the result includes a usage field.
 */
export function parseClaudeUsage(_stdout: string, stderr: string): TokenUsage | null {
  // Try to parse from stderr usage summary
  const inputMatch = stderr.match(/[Ii]nput\s*tokens?:\s*([\d,]+)/);
  const outputMatch = stderr.match(/[Oo]utput\s*tokens?:\s*([\d,]+)/);
  if (inputMatch || outputMatch) {
    return {
      input_tokens: inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : null,
      output_tokens: outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : null,
    };
  }
  return null;
}

/**
 * Parse token usage from Codex CLI output (best-effort).
 * Returns null if format is not recognized -- graceful degradation.
 */
export function parseCodexUsage(_stdout: string, stderr: string): TokenUsage | null {
  // Codex may print token info to stderr -- best-effort extraction
  const inputMatch = stderr.match(/[Ii]nput\s*tokens?:\s*([\d,]+)/);
  const outputMatch = stderr.match(/[Oo]utput\s*tokens?:\s*([\d,]+)/);
  if (inputMatch || outputMatch) {
    return {
      input_tokens: inputMatch ? parseInt(inputMatch[1].replace(/,/g, ''), 10) : null,
      output_tokens: outputMatch ? parseInt(outputMatch[1].replace(/,/g, ''), 10) : null,
    };
  }
  return null;
}

// ── Usage artifact ──────────────────────────────────────────────────

export interface UsageEntry {
  turn: number;
  from: string;
  model: string;
  tokens_in: number | null;
  tokens_out: number | null;
  cost_usd: number | null;
  duration_ms: number;
}

export interface UsageArtifact {
  turns: UsageEntry[];
  totals: {
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    duration_ms: number;
  };
  updated_at: string;
}

/** Build a usage artifact from accumulated entries. */
export function buildUsageArtifact(entries: UsageEntry[]): UsageArtifact {
  const totals = entries.reduce(
    (acc, e) => ({
      tokens_in: acc.tokens_in + (e.tokens_in ?? 0),
      tokens_out: acc.tokens_out + (e.tokens_out ?? 0),
      cost_usd: acc.cost_usd + (e.cost_usd ?? 0),
      duration_ms: acc.duration_ms + e.duration_ms,
    }),
    { tokens_in: 0, tokens_out: 0, cost_usd: 0, duration_ms: 0 },
  );
  // Round cost to 4 decimal places
  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
  return {
    turns: entries,
    totals,
    updated_at: new Date().toISOString(),
  };
}
