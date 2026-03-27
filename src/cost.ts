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
 * Cost is computed per-invocation (each priced at its own model's rate) and
 * summed, rather than estimating once from merged tokens at the final model's
 * rate. This handles mixed-tier retries correctly -- e.g., a fast-tier initial
 * invocation followed by a full-tier validation retry.
 *
 * Exported so that tests can exercise the exact same code path the orchestrator uses.
 */
export class TurnCostTracker {
  private _usage: TokenUsage | undefined;
  private _costParts: number[] = [];
  private _hasPerInvocationCosts = false;
  private _hasUnpricedUsage = false;

  /**
   * Record usage from an invocation result.
   * @param result - The invocation result containing optional usage data.
   * @param modelName - The model used for this invocation (for per-invocation cost estimation).
   *
   * If any invocation has usage data but cannot be priced (unknown model or
   * null tokens), finalize() will emit cost_usd = null rather than a partial
   * sum. This prevents silent underreporting when only some retries are priceable.
   */
  record(result: { usage?: TokenUsage }, modelName?: string): void {
    this._usage = mergeUsage(this._usage, result.usage);
    if (result.usage && modelName) {
      const partCost = estimateCost(modelName, result.usage);
      if (partCost !== null) {
        this._costParts.push(partCost);
        this._hasPerInvocationCosts = true;
      } else {
        this._hasUnpricedUsage = true;
      }
    } else if (result.usage) {
      // Usage exists but no model name provided -- cannot price this invocation
      this._hasUnpricedUsage = true;
    }
  }

  /**
   * Attach accumulated usage to canonical turn data.
   * Sets tokens_in, tokens_out, and cost_usd fields.
   *
   * Cost rules:
   * - If ANY invocation had usage but could not be priced, cost_usd = null
   *   (prevents silent underreporting from partial sums).
   * - Otherwise, cost is the sum of per-invocation costs when model names
   *   were provided to record().
   * - Falls back to single-model estimation from data.model_name when no
   *   per-invocation costs were recorded and no unpriced usage exists.
   * - No-op if no usage was recorded at all.
   */
  finalize(data: { model_name?: string; tokens_in?: number | null; tokens_out?: number | null; cost_usd?: number | null }): void {
    if (!this._usage) return;
    data.tokens_in = this._usage.input_tokens ?? null;
    data.tokens_out = this._usage.output_tokens ?? null;
    if (this._hasUnpricedUsage) {
      // At least one invocation had usage but no estimable cost --
      // emitting a partial sum would silently underreport spend.
      data.cost_usd = null;
    } else if (this._hasPerInvocationCosts) {
      const total = this._costParts.reduce((a, b) => a + b, 0);
      data.cost_usd = Math.round(total * 10000) / 10000;
    } else {
      // Fallback: no per-invocation model info (e.g., record() called without modelName)
      data.cost_usd = data.model_name ? estimateCost(data.model_name, this._usage) : null;
    }
  }

  /** Get accumulated usage (read-only, for inspection/testing). */
  get usage(): TokenUsage | undefined {
    return this._usage;
  }

  /**
   * Get per-invocation cost sum (read-only, for inspection/testing).
   * Returns null if no per-invocation costs were recorded or if any
   * invocation had usage but could not be priced.
   */
  get cost(): number | null {
    if (this._hasUnpricedUsage) return null;
    return this._hasPerInvocationCosts
      ? Math.round(this._costParts.reduce((a, b) => a + b, 0) * 10000) / 10000
      : null;
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

// ── Per-agent usage summary ─────────────────────────────────────────

export interface AgentUsageSummary {
  agent: string;
  turns: number;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number | null;
}

/**
 * Aggregate UsageEntry[] by the `from` field (agent identity).
 * Null token counts are treated as 0. If ANY entry for an agent has
 * cost_usd === null, that agent's cost is null (unknown).
 * Results are sorted alphabetically by agent name.
 */
export function buildAgentSummary(entries: UsageEntry[]): AgentUsageSummary[] {
  const map = new Map<string, AgentUsageSummary>();
  for (const e of entries) {
    let row = map.get(e.from);
    if (!row) {
      row = { agent: e.from, turns: 0, tokens_in: 0, tokens_out: 0, cost_usd: 0 };
      map.set(e.from, row);
    }
    row.turns += 1;
    row.tokens_in += e.tokens_in ?? 0;
    row.tokens_out += e.tokens_out ?? 0;
    if (row.cost_usd === null || e.cost_usd === null) {
      row.cost_usd = null;
    } else {
      row.cost_usd = Math.round((row.cost_usd + e.cost_usd) * 10000) / 10000;
    }
  }
  return [...map.values()].sort((a, b) => a.agent.localeCompare(b.agent));
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
