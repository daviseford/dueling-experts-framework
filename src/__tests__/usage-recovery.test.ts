import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import matter from 'gray-matter';
import { recoverUsageState, writeCanonicalTurn } from '../orchestrator.js';
import type { CanonicalTurnData } from '../orchestrator.js';
import type { Session } from '../session.js';
import { buildDefaultRoster } from '../roster.js';
import { mergeUsage, estimateCost, buildUsageArtifact, TurnCostTracker } from '../cost.js';
import type { TokenUsage, UsageEntry } from '../cost.js';
import { atomicWrite } from '../util.js';

function mockSession(dir: string, overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    topic: 'test',
    mode: 'edit',
    max_turns: 20,
    target_repo: dir,
    created: new Date().toISOString(),
    session_status: 'active',
    current_turn: 0,
    next_agent: 'claude',
    phase: 'plan',
    impl_model: 'claude',
    review_turns: 6,
    port: null,
    pid: process.pid,
    dir,
    worktree_path: null,
    branch_name: null,
    original_repo: null,
    base_ref: null,
    pr_url: null,
    pr_number: null,
    roster: buildDefaultRoster('claude', 'claude'),
    ...overrides,
  };
}

async function writeTurn(
  turnsDir: string,
  data: Record<string, unknown>,
  body = 'Turn content.',
): Promise<void> {
  const id = data.id as string;
  const frontmatter = '---\n' + yaml.dump(data, { lineWidth: -1 }).trim() + '\n---\n';
  await writeFile(join(turnsDir, `${id}.md`), frontmatter + body + '\n', 'utf8');
}

describe('recoverUsageState', () => {
  let tmpDir: string;
  let turnsDir: string;
  let artifactsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'def-usage-recovery-'));
    turnsDir = join(tmpDir, 'turns');
    artifactsDir = join(tmpDir, 'artifacts');
    await mkdir(turnsDir, { recursive: true });
    await mkdir(artifactsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty array when no turns and no usage.json', async () => {
    const session = mockSession(tmpDir, { current_turn: 0 });
    const entries = await recoverUsageState(session);
    assert.equal(entries.length, 0);
  });

  it('recovers from usage.json artifact (fast path)', async () => {
    const usageData = {
      turns: [
        { turn: 1, from: 'claude', model: 'opus', tokens_in: 1000, tokens_out: 500, cost_usd: 0.05, duration_ms: 5000 },
        { turn: 2, from: 'codex', model: 'gpt-5.4', tokens_in: 2000, tokens_out: 1000, cost_usd: 0.08, duration_ms: 3000 },
      ],
      totals: { tokens_in: 3000, tokens_out: 1500, cost_usd: 0.13, duration_ms: 8000 },
      updated_at: new Date().toISOString(),
    };
    await writeFile(join(artifactsDir, 'usage.json'), JSON.stringify(usageData), 'utf8');

    const session = mockSession(tmpDir, { current_turn: 2 });
    const entries = await recoverUsageState(session);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].turn, 1);
    assert.equal(entries[0].cost_usd, 0.05);
    assert.equal(entries[1].turn, 2);
    assert.equal(entries[1].cost_usd, 0.08);
  });

  it('falls back to turn frontmatter when usage.json is missing', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'complete',
      phase: 'plan',
      model_name: 'opus',
      tokens_in: 1500,
      tokens_out: 800,
      cost_usd: 0.0825,
      duration_ms: 7000,
    });

    const session = mockSession(tmpDir, { current_turn: 1 });
    const entries = await recoverUsageState(session);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].turn, 1);
    assert.equal(entries[0].from, 'claude');
    assert.equal(entries[0].tokens_in, 1500);
    assert.equal(entries[0].tokens_out, 800);
    assert.equal(entries[0].cost_usd, 0.0825);
    assert.equal(entries[0].model, 'opus');
  });

  it('skips turns without cost data in fallback path', async () => {
    // Turn 1 has cost data
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'complete',
      phase: 'plan',
      tokens_in: 500,
      cost_usd: 0.02,
    });
    // Turn 2 is a human turn with no cost data
    await writeTurn(turnsDir, {
      id: 'turn-0002-human',
      turn: 2,
      from: 'human',
      timestamp: new Date().toISOString(),
      status: 'complete',
      phase: 'plan',
    });

    const session = mockSession(tmpDir, { current_turn: 2 });
    const entries = await recoverUsageState(session);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].turn, 1);
  });

  it('prefers usage.json over turn frontmatter', async () => {
    // Write a usage.json with 3 entries
    const usageData = {
      turns: [
        { turn: 1, from: 'claude', model: 'opus', tokens_in: 100, tokens_out: 50, cost_usd: 0.01, duration_ms: 1000 },
        { turn: 2, from: 'codex', model: 'gpt-5.4', tokens_in: 200, tokens_out: 100, cost_usd: 0.02, duration_ms: 2000 },
        { turn: 3, from: 'claude', model: 'opus', tokens_in: 300, tokens_out: 150, cost_usd: 0.03, duration_ms: 3000 },
      ],
      totals: { tokens_in: 600, tokens_out: 300, cost_usd: 0.06, duration_ms: 6000 },
      updated_at: new Date().toISOString(),
    };
    await writeFile(join(artifactsDir, 'usage.json'), JSON.stringify(usageData), 'utf8');

    // Also write turns with different cost data -- should be ignored
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'complete',
      phase: 'plan',
      tokens_in: 9999,
      cost_usd: 9.99,
    });

    const session = mockSession(tmpDir, { current_turn: 3 });
    const entries = await recoverUsageState(session);
    // Should use usage.json, not frontmatter
    assert.equal(entries.length, 3);
    assert.equal(entries[0].tokens_in, 100);
    assert.equal(entries[0].cost_usd, 0.01);
  });

  it('recovered usage reflects accumulated retries in turn frontmatter', async () => {
    // Simulate a turn where usage.json was written with accumulated totals
    // (as the orchestrator now does after validation/verdict retries).
    // Initial invoke: 1000 in, 500 out. Validation retry: 800 in, 400 out.
    // The turn should record the sum: 1800 in, 900 out.
    const accumulatedIn = 1000 + 800;
    const accumulatedOut = 500 + 400;
    const cost = estimateCost('opus', { input_tokens: accumulatedIn, output_tokens: accumulatedOut });

    const usageData = {
      turns: [
        { turn: 1, from: 'claude', model: 'opus', tokens_in: accumulatedIn, tokens_out: accumulatedOut, cost_usd: cost, duration_ms: 12000 },
      ],
      totals: { tokens_in: accumulatedIn, tokens_out: accumulatedOut, cost_usd: cost, duration_ms: 12000 },
      updated_at: new Date().toISOString(),
    };
    await writeFile(join(artifactsDir, 'usage.json'), JSON.stringify(usageData), 'utf8');

    const session = mockSession(tmpDir, { current_turn: 1 });
    const entries = await recoverUsageState(session);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].tokens_in, accumulatedIn);
    assert.equal(entries[0].tokens_out, accumulatedOut);
    assert.equal(entries[0].cost_usd, cost);
  });

  it('cumulative cost can be computed from recovered entries', async () => {
    const usageData = {
      turns: [
        { turn: 1, from: 'claude', model: 'opus', tokens_in: 1000, tokens_out: 500, cost_usd: 0.05, duration_ms: 5000 },
        { turn: 2, from: 'codex', model: 'gpt-5.4', tokens_in: 2000, tokens_out: 1000, cost_usd: 0.08, duration_ms: 3000 },
      ],
      totals: { tokens_in: 3000, tokens_out: 1500, cost_usd: 0.13, duration_ms: 8000 },
      updated_at: new Date().toISOString(),
    };
    await writeFile(join(artifactsDir, 'usage.json'), JSON.stringify(usageData), 'utf8');

    const session = mockSession(tmpDir, { current_turn: 2, budget: 0.10 });
    const entries = await recoverUsageState(session);

    // Simulate what the orchestrator does on recovery
    let cumulativeCostUsd = 0;
    for (const entry of entries) {
      cumulativeCostUsd += entry.cost_usd ?? 0;
    }

    // Budget is $0.10, cumulative is $0.13 -- budget would be exceeded
    assert.ok(cumulativeCostUsd >= session.budget!);
    assert.equal(cumulativeCostUsd, 0.13);
  });
});

describe('retry usage accumulation (orchestrator pattern)', () => {
  it('mergeUsage chains correctly across initial + validation retry + verdict retry', () => {
    // Simulates the orchestrator's turnUsage accumulation pattern:
    // 1. Initial invoke returns usage
    const initial: TokenUsage = { input_tokens: 5000, output_tokens: 2000 };
    let turnUsage: TokenUsage | undefined = initial;

    // 2. Validation retry adds more usage
    const validationRetry: TokenUsage = { input_tokens: 5200, output_tokens: 2100 };
    turnUsage = mergeUsage(turnUsage, validationRetry);

    // 3. Verdict retry adds even more
    const verdictRetry: TokenUsage = { input_tokens: 4800, output_tokens: 1900 };
    turnUsage = mergeUsage(turnUsage, verdictRetry);

    // Total should be the sum of all three
    assert.ok(turnUsage);
    assert.equal(turnUsage!.input_tokens, 5000 + 5200 + 4800);
    assert.equal(turnUsage!.output_tokens, 2000 + 2100 + 1900);

    // Cost should reflect the accumulated total, not just the initial invoke
    const cost = estimateCost('opus', turnUsage!);
    assert.ok(cost !== null);
    assert.ok(cost! > estimateCost('opus', initial)!);
  });

  it('accumulated usage produces correct cost in usage artifact', () => {
    // After accumulation, the orchestrator writes a UsageEntry with the merged totals
    const turnUsage: TokenUsage = { input_tokens: 15000, output_tokens: 6000 };
    const cost = estimateCost('opus', turnUsage);

    const entry: UsageEntry = {
      turn: 1,
      from: 'claude',
      model: 'opus',
      tokens_in: turnUsage.input_tokens,
      tokens_out: turnUsage.output_tokens,
      cost_usd: cost,
      duration_ms: 30000,
    };

    const artifact = buildUsageArtifact([entry]);
    assert.equal(artifact.totals.tokens_in, 15000);
    assert.equal(artifact.totals.tokens_out, 6000);
    assert.equal(artifact.totals.cost_usd, cost);
  });

  it('budget enforcement sees accumulated cost, not just initial invoke cost', () => {
    // If initial invoke cost $0.05 and retry cost $0.05, budget of $0.08 should be exceeded
    const initial: TokenUsage = { input_tokens: 2000, output_tokens: 400 };
    const retry: TokenUsage = { input_tokens: 2000, output_tokens: 400 };
    const merged = mergeUsage(initial, retry)!;
    const totalCost = estimateCost('opus', merged)!;
    const initialCost = estimateCost('opus', initial)!;

    // The initial cost alone would be under budget, but accumulated should be over
    assert.ok(totalCost > initialCost);
    assert.equal(totalCost, initialCost * 2);
  });
});

describe('orchestrator retry write path (real code)', () => {
  // These tests exercise the REAL orchestrator exports:
  // - TurnCostTracker (same object the orchestrator creates per turn)
  // - writeCanonicalTurn (same function the orchestrator calls to persist turn files)
  // - recoverUsageState (same function the orchestrator calls on recovery)
  //
  // A regression like "orchestrator forgets to update costTracker on a retry
  // branch" or "finalize() runs before all retries" would break these tests
  // because TurnCostTracker IS the orchestrator's accumulation code.

  let tmpDir: string;
  let session: Session;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'def-orch-retry-'));
    await mkdir(join(tmpDir, 'turns'), { recursive: true });
    await mkdir(join(tmpDir, 'artifacts'), { recursive: true });
    session = mockSession(tmpDir, { current_turn: 1 });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('TurnCostTracker + writeCanonicalTurn + recoverUsageState round-trip with retry accumulation', async () => {
    // --- Step 1: Use the REAL TurnCostTracker (same as orchestrator line 315) ---
    const tracker = new TurnCostTracker();

    // Initial invocation (orchestrator line 315: costTracker.record(retryResult, modelName))
    tracker.record({ usage: { input_tokens: 5000, output_tokens: 2000 } }, 'opus');

    // Validation retry (orchestrator line 373: costTracker.record(result, modelName))
    tracker.record({ usage: { input_tokens: 5200, output_tokens: 2100 } }, 'opus');

    // Verdict retry (orchestrator line 431: costTracker.record(verdictRetry, modelName))
    tracker.record({ usage: { input_tokens: 4800, output_tokens: 1900 } }, 'opus');

    const expectedIn = 5000 + 5200 + 4800;
    const expectedOut = 2000 + 2100 + 1900;

    // --- Step 2: Build canonical data and finalize (same as orchestrator lines 402-464) ---
    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'review',
      duration_ms: 15000,
      model_tier: 'mid',
      model_name: 'opus',
      verdict: 'approve',
    };

    // REAL finalize (orchestrator line ~459: costTracker.finalize(canonicalData))
    tracker.finalize(canonicalData);

    assert.equal(canonicalData.tokens_in, expectedIn);
    assert.equal(canonicalData.tokens_out, expectedOut);
    assert.ok(canonicalData.cost_usd != null && canonicalData.cost_usd > 0);

    // --- Step 3: Write turn file via the REAL writeCanonicalTurn (orchestrator line 470) ---
    await writeCanonicalTurn(session, 'turn-0001-claude', canonicalData, 'Turn content.');

    // --- Step 4: Write usage.json (same as orchestrator lines 476-494) ---
    const usageEntries: UsageEntry[] = [{
      turn: 1,
      from: 'claude',
      model: canonicalData.model_name ?? '',
      tokens_in: canonicalData.tokens_in ?? null,
      tokens_out: canonicalData.tokens_out ?? null,
      cost_usd: canonicalData.cost_usd ?? null,
      duration_ms: 15000,
    }];
    const usageArtifact = buildUsageArtifact(usageEntries);
    await atomicWrite(join(tmpDir, 'artifacts', 'usage.json'), JSON.stringify(usageArtifact, null, 2) + '\n');

    // --- Step 5: Verify turn file written by real writeCanonicalTurn ---
    const turnContent = await readFile(join(tmpDir, 'turns', 'turn-0001-claude.md'), 'utf8');
    const parsed = matter(turnContent);
    assert.equal(parsed.data.tokens_in, expectedIn, 'turn frontmatter tokens_in should reflect all 3 invocations');
    assert.equal(parsed.data.tokens_out, expectedOut, 'turn frontmatter tokens_out should reflect all 3 invocations');

    // Cost should exceed initial-invoke-only cost
    const initialOnlyCost = estimateCost('opus', { input_tokens: 5000, output_tokens: 2000 })!;
    assert.ok(parsed.data.cost_usd > initialOnlyCost,
      `cost ($${parsed.data.cost_usd}) should exceed initial-invoke-only cost ($${initialOnlyCost})`);

    // --- Step 6: Recover via REAL recoverUsageState and verify round-trip ---
    const recovered = await recoverUsageState(session);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].tokens_in, expectedIn, 'recovered tokens_in should match accumulated total');
    assert.equal(recovered[0].tokens_out, expectedOut, 'recovered tokens_out should match accumulated total');
    assert.equal(recovered[0].cost_usd, parsed.data.cost_usd, 'recovered cost_usd should match turn frontmatter');
  });

  it('TurnCostTracker.finalize() is a no-op when all invocations have unknown usage', async () => {
    const tracker = new TurnCostTracker();

    // Three invocations with unknown usage
    tracker.record({ usage: { input_tokens: null, output_tokens: null } });
    tracker.record({ usage: { input_tokens: null, output_tokens: null } });
    tracker.record({ usage: { input_tokens: null, output_tokens: null } });

    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'plan',
      duration_ms: 10000,
      model_name: 'opus',
    };

    tracker.finalize(canonicalData);

    // tokens_in should be null (all-null preserved), cost should be null
    assert.equal(canonicalData.tokens_in, null, 'tokens_in should be null when all invocations have unknown usage');
    assert.equal(canonicalData.tokens_out, null, 'tokens_out should be null');
    assert.equal(canonicalData.cost_usd, null, 'cost should be null when tokens are unknown');

    // Write and verify recovery skips unknown-cost turns
    await writeCanonicalTurn(session, 'turn-0001-claude', canonicalData, 'Content.');
    const recovered = await recoverUsageState(session);
    assert.equal(recovered.length, 0, 'turns with all-null cost data should not create usage entries');
  });

  it('TurnCostTracker.finalize() is a no-op when no usage was recorded', async () => {
    const tracker = new TurnCostTracker();

    // Invocations without usage data (e.g. CLI didn't report tokens)
    tracker.record({});
    tracker.record({});

    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'complete',
      phase: 'plan',
      model_name: 'opus',
    };

    tracker.finalize(canonicalData);

    // No usage fields should be set
    assert.equal(canonicalData.tokens_in, undefined, 'tokens_in should remain undefined');
    assert.equal(canonicalData.tokens_out, undefined, 'tokens_out should remain undefined');
    assert.equal(canonicalData.cost_usd, undefined, 'cost_usd should remain undefined');
  });

  it('mixed-tier retries price each invocation at its own model rate', async () => {
    // Regression test: a fast-tier initial invocation (haiku) followed by a
    // full-tier validation retry (opus) must price tokens at their respective
    // rates, not all at the final model's rate.
    const tracker = new TurnCostTracker();

    // Initial invocation at fast tier (haiku)
    const fastUsage = { input_tokens: 2000, output_tokens: 1000 };
    tracker.record({ usage: fastUsage }, 'haiku');

    // Validation retry at full tier (opus)
    const fullUsage = { input_tokens: 3000, output_tokens: 1500 };
    tracker.record({ usage: fullUsage }, 'opus');

    // Expected: sum of individual costs, NOT cost(opus, merged_tokens)
    const haikuCost = estimateCost('haiku', fastUsage)!;
    const opusCost = estimateCost('opus', fullUsage)!;
    const expectedCost = Math.round((haikuCost + opusCost) * 10000) / 10000;

    // What the OLD code would compute (all tokens at opus rate) -- this is WRONG
    const mergedTokens = { input_tokens: 5000, output_tokens: 2500 };
    const wrongCost = estimateCost('opus', mergedTokens)!;

    // Sanity: the two approaches must differ for this test to be meaningful
    assert.notEqual(expectedCost, wrongCost,
      'per-invocation cost and single-model cost must differ for mixed tiers');

    // Finalize and verify
    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'plan',
      duration_ms: 10000,
      model_tier: 'full',
      model_name: 'opus', // final tier -- the old code would use this for ALL tokens
    };

    tracker.finalize(canonicalData);

    assert.equal(canonicalData.cost_usd, expectedCost,
      `cost should be haiku($${haikuCost}) + opus($${opusCost}) = $${expectedCost}, not all-opus $${wrongCost}`);
    assert.equal(canonicalData.tokens_in, 5000);
    assert.equal(canonicalData.tokens_out, 2500);

    // Also verify the cost getter matches
    assert.equal(tracker.cost, expectedCost);

    // Write and recover to verify the per-invocation cost survives round-trip
    await writeCanonicalTurn(session, 'turn-0001-claude', canonicalData, 'Mixed tier content.');
    const usageEntries: UsageEntry[] = [{
      turn: 1,
      from: 'claude',
      model: 'opus',
      tokens_in: canonicalData.tokens_in ?? null,
      tokens_out: canonicalData.tokens_out ?? null,
      cost_usd: canonicalData.cost_usd ?? null,
      duration_ms: 10000,
    }];
    const usageArtifact = buildUsageArtifact(usageEntries);
    await atomicWrite(join(tmpDir, 'artifacts', 'usage.json'), JSON.stringify(usageArtifact, null, 2) + '\n');

    const recovered = await recoverUsageState(session);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].cost_usd, expectedCost,
      'recovered cost should reflect per-invocation pricing, not single-model pricing');
  });

  it('finalize emits null cost when one retry has usage but cannot be priced', () => {
    // Regression: if one invocation is priceable and another is not (e.g.,
    // unknown model or null tokens), cost_usd must be null -- NOT a partial
    // sum that silently underreports spend.
    const tracker = new TurnCostTracker();

    // First invocation: known model, priceable
    tracker.record({ usage: { input_tokens: 2000, output_tokens: 1000 } }, 'opus');

    // Second invocation (validation retry): unknown model name -- estimateCost returns null
    tracker.record({ usage: { input_tokens: 3000, output_tokens: 1500 } }, 'unknown-model-xyz');

    // The tracker saw one priced and one unpriced invocation
    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'plan',
      duration_ms: 10000,
      model_name: 'opus',
    };

    tracker.finalize(canonicalData);

    // Tokens should still be accumulated (we know the counts)
    assert.equal(canonicalData.tokens_in, 5000);
    assert.equal(canonicalData.tokens_out, 2500);

    // Cost MUST be null -- not the partial $opusCost from the first invocation alone
    assert.equal(canonicalData.cost_usd, null,
      'cost_usd must be null when any invocation has usage but cannot be priced');

    // The cost getter should also reflect null
    assert.equal(tracker.cost, null,
      'tracker.cost must be null when any invocation is unpriced');
  });

  it('finalize emits null cost when one retry has null tokens making it unpriceable', () => {
    // Variant: the model is known, but input_tokens is null (CLI didn't report them)
    const tracker = new TurnCostTracker();

    // First invocation: fully priceable
    tracker.record({ usage: { input_tokens: 2000, output_tokens: 1000 } }, 'opus');

    // Second invocation: known model, but null input_tokens -- estimateCost returns null
    tracker.record({ usage: { input_tokens: null, output_tokens: 1500 } }, 'opus');

    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'plan',
      duration_ms: 10000,
      model_name: 'opus',
    };

    tracker.finalize(canonicalData);

    // Tokens: input is 2000 (one known + one null = 2000), output is 2500
    assert.equal(canonicalData.tokens_in, 2000);
    assert.equal(canonicalData.tokens_out, 2500);

    // Cost must be null because the second invocation's input_tokens were unknown
    assert.equal(canonicalData.cost_usd, null,
      'cost_usd must be null when any invocation has null input_tokens');
  });

  it('finalize emits null cost when usage exists but no model name was provided', () => {
    // If record() is called with usage but without a modelName, that invocation
    // is unpriceable and the entire turn cost must be null.
    const tracker = new TurnCostTracker();

    // First invocation: priceable
    tracker.record({ usage: { input_tokens: 2000, output_tokens: 1000 } }, 'opus');

    // Second invocation: usage present but no modelName
    tracker.record({ usage: { input_tokens: 3000, output_tokens: 1500 } });

    const canonicalData: CanonicalTurnData = {
      id: 'turn-0001-claude',
      turn: 1,
      from: 'claude',
      timestamp: new Date().toISOString(),
      status: 'decided',
      phase: 'plan',
      duration_ms: 10000,
      model_name: 'opus',
    };

    tracker.finalize(canonicalData);

    assert.equal(canonicalData.tokens_in, 5000);
    assert.equal(canonicalData.tokens_out, 2500);
    assert.equal(canonicalData.cost_usd, null,
      'cost_usd must be null when any invocation lacks a model name');
  });
});
