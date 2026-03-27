import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateCost, parseClaudeUsage, parseCodexUsage, buildUsageArtifact, buildAgentSummary, loadRates, mergeUsage } from '../cost.js';
import type { TokenUsage, UsageEntry } from '../cost.js';

describe('loadRates', () => {
  it('returns default rates when no env var is set', () => {
    const rates = loadRates();
    assert.ok(rates.opus);
    assert.ok(rates.sonnet);
    assert.ok(rates.haiku);
    assert.ok(rates['gpt-5.4']);
  });
});

describe('estimateCost', () => {
  it('estimates cost for a known model', () => {
    const usage: TokenUsage = { input_tokens: 1000, output_tokens: 500 };
    const cost = estimateCost('opus', usage);
    assert.ok(cost !== null);
    assert.ok(cost! > 0);
    // opus: input=0.015/1k, output=0.075/1k
    // Expected: (1000/1000)*0.015 + (500/1000)*0.075 = 0.015 + 0.0375 = 0.0525
    assert.equal(cost, 0.0525);
  });

  it('returns null for an unknown model', () => {
    const usage: TokenUsage = { input_tokens: 1000, output_tokens: 500 };
    const cost = estimateCost('unknown-model', usage);
    assert.equal(cost, null);
  });

  it('returns null when input_tokens is null', () => {
    const usage: TokenUsage = { input_tokens: null, output_tokens: 500 };
    const cost = estimateCost('opus', usage);
    assert.equal(cost, null);
  });

  it('handles null output_tokens gracefully', () => {
    const usage: TokenUsage = { input_tokens: 1000, output_tokens: null };
    const cost = estimateCost('opus', usage);
    assert.ok(cost !== null);
    // Only input cost: (1000/1000)*0.015 = 0.015
    assert.equal(cost, 0.015);
  });
});

describe('parseClaudeUsage', () => {
  it('parses token counts from stderr', () => {
    const stderr = 'Some output\nInput tokens: 12,345\nOutput tokens: 6,789\nMore output';
    const usage = parseClaudeUsage('', stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 12345);
    assert.equal(usage!.output_tokens, 6789);
  });

  it('returns null when no token info in stderr', () => {
    const usage = parseClaudeUsage('', 'No token info here');
    assert.equal(usage, null);
  });

  it('handles partial token info (only input)', () => {
    const stderr = 'Input tokens: 500';
    const usage = parseClaudeUsage('', stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 500);
    assert.equal(usage!.output_tokens, null);
  });
});

describe('parseCodexUsage', () => {
  it('parses token counts from stderr', () => {
    const stderr = 'Input tokens: 1000\nOutput tokens: 2000';
    const usage = parseCodexUsage('', stderr);
    assert.ok(usage);
    assert.equal(usage!.input_tokens, 1000);
    assert.equal(usage!.output_tokens, 2000);
  });

  it('returns null when no token info', () => {
    const usage = parseCodexUsage('', '');
    assert.equal(usage, null);
  });
});

describe('mergeUsage', () => {
  it('returns undefined when both inputs are undefined', () => {
    assert.equal(mergeUsage(undefined, undefined), undefined);
  });

  it('returns b when a is undefined', () => {
    const b: TokenUsage = { input_tokens: 100, output_tokens: 50 };
    assert.deepEqual(mergeUsage(undefined, b), b);
  });

  it('returns a when b is undefined', () => {
    const a: TokenUsage = { input_tokens: 100, output_tokens: 50 };
    assert.deepEqual(mergeUsage(a, undefined), a);
  });

  it('sums token counts from two invocations', () => {
    const a: TokenUsage = { input_tokens: 1000, output_tokens: 500 };
    const b: TokenUsage = { input_tokens: 2000, output_tokens: 800 };
    const merged = mergeUsage(a, b)!;
    assert.equal(merged.input_tokens, 3000);
    assert.equal(merged.output_tokens, 1300);
  });

  it('preserves null when both sides have null for a field', () => {
    const a: TokenUsage = { input_tokens: null, output_tokens: 500 };
    const b: TokenUsage = { input_tokens: null, output_tokens: 600 };
    const merged = mergeUsage(a, b)!;
    assert.equal(merged.input_tokens, null);
    assert.equal(merged.output_tokens, 1100);
  });

  it('treats one-sided null as zero when the other side has a value', () => {
    const a: TokenUsage = { input_tokens: 1000, output_tokens: null };
    const b: TokenUsage = { input_tokens: null, output_tokens: 600 };
    const merged = mergeUsage(a, b)!;
    assert.equal(merged.input_tokens, 1000);
    assert.equal(merged.output_tokens, 600);
  });

  it('returns all-null when both sides are fully unknown', () => {
    const a: TokenUsage = { input_tokens: null, output_tokens: null };
    const b: TokenUsage = { input_tokens: null, output_tokens: null };
    const merged = mergeUsage(a, b)!;
    assert.equal(merged.input_tokens, null);
    assert.equal(merged.output_tokens, null);
  });
});

describe('buildUsageArtifact', () => {
  it('builds artifact with correct totals', () => {
    const entries: UsageEntry[] = [
      { turn: 1, from: 'claude', model: 'opus', tokens_in: 1000, tokens_out: 500, cost_usd: 0.05, duration_ms: 5000 },
      { turn: 2, from: 'codex', model: 'gpt-5.4', tokens_in: 2000, tokens_out: 1000, cost_usd: 0.08, duration_ms: 3000 },
    ];
    const artifact = buildUsageArtifact(entries);
    assert.equal(artifact.turns.length, 2);
    assert.equal(artifact.totals.tokens_in, 3000);
    assert.equal(artifact.totals.tokens_out, 1500);
    assert.equal(artifact.totals.cost_usd, 0.13);
    assert.equal(artifact.totals.duration_ms, 8000);
    assert.ok(artifact.updated_at);
  });

  it('handles null values in entries', () => {
    const entries: UsageEntry[] = [
      { turn: 1, from: 'claude', model: 'opus', tokens_in: null, tokens_out: null, cost_usd: null, duration_ms: 5000 },
    ];
    const artifact = buildUsageArtifact(entries);
    assert.equal(artifact.totals.tokens_in, 0);
    assert.equal(artifact.totals.tokens_out, 0);
    assert.equal(artifact.totals.cost_usd, 0);
    assert.equal(artifact.totals.duration_ms, 5000);
  });

  it('handles empty entries', () => {
    const artifact = buildUsageArtifact([]);
    assert.equal(artifact.turns.length, 0);
    assert.equal(artifact.totals.tokens_in, 0);
    assert.equal(artifact.totals.cost_usd, 0);
  });
});

describe('buildAgentSummary', () => {
  it('aggregates entries by agent (mixed providers)', () => {
    const entries: UsageEntry[] = [
      { turn: 1, from: 'claude', model: 'opus', tokens_in: 10000, tokens_out: 5000, cost_usd: 1.50, duration_ms: 5000 },
      { turn: 2, from: 'codex', model: 'gpt-5.4', tokens_in: 8000, tokens_out: 3000, cost_usd: 0.80, duration_ms: 3000 },
      { turn: 3, from: 'claude', model: 'opus', tokens_in: 12000, tokens_out: 4000, cost_usd: 2.00, duration_ms: 6000 },
    ];
    const summary = buildAgentSummary(entries);
    assert.equal(summary.length, 2);

    // Sorted alphabetically: claude first, codex second
    assert.equal(summary[0].agent, 'claude');
    assert.equal(summary[0].turns, 2);
    assert.equal(summary[0].tokens_in, 22000);
    assert.equal(summary[0].tokens_out, 9000);

    assert.equal(summary[1].agent, 'codex');
    assert.equal(summary[1].turns, 1);
    assert.equal(summary[1].tokens_in, 8000);
    assert.equal(summary[1].tokens_out, 3000);
  });

  it('returns single-agent summary', () => {
    const entries: UsageEntry[] = [
      { turn: 1, from: 'claude', model: 'opus', tokens_in: 5000, tokens_out: 2000, cost_usd: 0.50, duration_ms: 3000 },
    ];
    const summary = buildAgentSummary(entries);
    assert.equal(summary.length, 1);
    assert.equal(summary[0].agent, 'claude');
    assert.equal(summary[0].turns, 1);
    assert.equal(summary[0].tokens_in, 5000);
    assert.equal(summary[0].tokens_out, 2000);
  });

  it('returns empty array for empty input', () => {
    const summary = buildAgentSummary([]);
    assert.equal(summary.length, 0);
  });

  it('treats null token counts as 0', () => {
    const entries: UsageEntry[] = [
      { turn: 1, from: 'claude', model: 'opus', tokens_in: null, tokens_out: null, cost_usd: null, duration_ms: 3000 },
      { turn: 2, from: 'claude', model: 'opus', tokens_in: 5000, tokens_out: 2000, cost_usd: 1.00, duration_ms: 3000 },
    ];
    const summary = buildAgentSummary(entries);
    assert.equal(summary[0].tokens_in, 5000);
    assert.equal(summary[0].tokens_out, 2000);
  });
});
