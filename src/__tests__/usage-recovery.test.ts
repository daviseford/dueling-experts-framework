import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { recoverUsageState } from '../orchestrator.js';
import type { Session } from '../session.js';
import { buildDefaultRoster } from '../roster.js';
import { mergeUsage, estimateCost, buildUsageArtifact } from '../cost.js';
import type { TokenUsage, UsageEntry } from '../cost.js';

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
