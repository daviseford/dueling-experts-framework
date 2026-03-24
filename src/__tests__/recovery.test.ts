import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { recoverEphemeralState } from '../orchestrator.js';
import type { Session } from '../session.js';

/**
 * Helper: write a turn file with the given frontmatter data and optional body.
 */
async function writeTurn(
  turnsDir: string,
  data: Record<string, unknown>,
  body = 'Turn content.',
): Promise<void> {
  const id = data.id as string;
  const frontmatter = '---\n' + yaml.dump(data, { lineWidth: -1 }).trim() + '\n---\n';
  await writeFile(join(turnsDir, `${id}.md`), frontmatter + body + '\n', 'utf8');
}

/**
 * Minimal mock session pointing at the given temp dir.
 */
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
    ...overrides,
  };
}

describe('recoverEphemeralState', () => {
  let tmpDir: string;
  let turnsDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'def-recovery-'));
    turnsDir = join(tmpDir, 'turns');
    await mkdir(turnsDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns empty state for no turns', async () => {
    const session = mockSession(tmpDir, { current_turn: 0 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.pendingPlanDecided, null);
    assert.equal(result.pendingReviewDecided, null);
    assert.equal(result.reviewLoopCount, 0);
  });

  // --- Plan-phase recovery ---

  it('tracks pending plan decided from first agent', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:00:00Z', status: 'decided', phase: 'plan',
    });

    const session = mockSession(tmpDir, { current_turn: 1 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.pendingPlanDecided, 'claude');
  });

  it('clears pending plan decided on two-agent consensus', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:00:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
    });

    const session = mockSession(tmpDir, { current_turn: 2 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.pendingPlanDecided, null);
  });

  it('clears pending plan decided when contested', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:00:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:01:00Z', status: 'complete', phase: 'plan',
    });

    const session = mockSession(tmpDir, { current_turn: 2 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.pendingPlanDecided, null);
  });

  it('handles legacy debate phase as plan', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:00:00Z', status: 'decided', phase: 'debate',
    });

    const session = mockSession(tmpDir, { current_turn: 1 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.pendingPlanDecided, 'claude');
  });

  // --- Review-phase recovery: single-agent verdict model ---

  it('tracks review decided with verdict approve', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'decided', phase: 'review',
      verdict: 'approve',
    });

    const session = mockSession(tmpDir, { current_turn: 5 });
    const result = await recoverEphemeralState(session);
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'approve' });
    assert.equal(result.reviewLoopCount, 0);
  });

  it('tracks review decided with verdict fix', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    const session = mockSession(tmpDir, { current_turn: 5 });
    const result = await recoverEphemeralState(session);
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'fix' });
    assert.equal(result.reviewLoopCount, 0);
  });

  it('maps legacy done in review to approve', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'done', phase: 'review',
    });

    const session = mockSession(tmpDir, { current_turn: 5 });
    const result = await recoverEphemeralState(session);
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'approve' });
  });

  it('does NOT default decided-without-verdict to approve in review', async () => {
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'decided', phase: 'review',
      // No verdict — the live loop would have errored
    });

    const session = mockSession(tmpDir, { current_turn: 5 });
    const result = await recoverEphemeralState(session);
    // Must NOT set pendingReviewDecided — this was an error case
    assert.equal(result.pendingReviewDecided, null);
  });

  // --- Review loop counting ---

  it('increments reviewLoopCount when fix verdict is followed by implement turn', async () => {
    // Review decided fix
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });
    // Implement turn following the fix transition
    await writeTurn(turnsDir, {
      id: 'turn-0006-claude', turn: 6, from: 'claude',
      timestamp: '2026-01-01T00:06:00Z', status: 'complete', phase: 'implement',
    });

    const session = mockSession(tmpDir, { current_turn: 6 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.reviewLoopCount, 1);
    assert.equal(result.pendingReviewDecided, null);
  });

  it('does not increment reviewLoopCount for approve verdict followed by implement', async () => {
    // This shouldn't happen in practice, but verifies the guard
    await writeTurn(turnsDir, {
      id: 'turn-0005-codex', turn: 5, from: 'codex',
      timestamp: '2026-01-01T00:05:00Z', status: 'decided', phase: 'review',
      verdict: 'approve',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0006-claude', turn: 6, from: 'claude',
      timestamp: '2026-01-01T00:06:00Z', status: 'complete', phase: 'implement',
    });

    const session = mockSession(tmpDir, { current_turn: 6 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.reviewLoopCount, 0);
    assert.equal(result.pendingReviewDecided, null);
  });

  // --- Full cycle: plan → implement → review fix → implement → review approve ---

  it('recovers full cycle with correct reviewLoopCount', async () => {
    // Plan consensus
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    // Implement
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    // Review: fix
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });
    // Second implement
    await writeTurn(turnsDir, {
      id: 'turn-0005-claude', turn: 5, from: 'claude',
      timestamp: '2026-01-01T00:05:00Z', status: 'complete', phase: 'implement',
    });
    // Review: approve
    await writeTurn(turnsDir, {
      id: 'turn-0006-codex', turn: 6, from: 'codex',
      timestamp: '2026-01-01T00:06:00Z', status: 'decided', phase: 'review',
      verdict: 'approve',
    });

    const session = mockSession(tmpDir, { current_turn: 6 });
    const result = await recoverEphemeralState(session);
    // Plan consensus completed — null
    assert.equal(result.pendingPlanDecided, null);
    // One fix cycle completed, then final approve is pending
    assert.equal(result.reviewLoopCount, 1);
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'approve' });
  });

  it('recovers crash mid-review: fix written but transition not completed', async () => {
    // Plan consensus
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    // Implement
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    // Review: fix — crash before transition to implement
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    const session = mockSession(tmpDir, { current_turn: 4, phase: 'review' });
    const result = await recoverEphemeralState(session);
    // Fix verdict is pending — the live loop should apply the transition
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'fix' });
    // No fix cycle was completed yet (implement turn didn't happen)
    assert.equal(result.reviewLoopCount, 0);
  });

  it('counts multiple fix cycles correctly', async () => {
    // First review fix + implement
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0005-claude', turn: 5, from: 'claude',
      timestamp: '2026-01-01T00:05:00Z', status: 'complete', phase: 'implement',
    });
    // Second review fix + implement
    await writeTurn(turnsDir, {
      id: 'turn-0006-codex', turn: 6, from: 'codex',
      timestamp: '2026-01-01T00:06:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0007-claude', turn: 7, from: 'claude',
      timestamp: '2026-01-01T00:07:00Z', status: 'complete', phase: 'implement',
    });
    // Third review: pending fix (crash)
    await writeTurn(turnsDir, {
      id: 'turn-0008-codex', turn: 8, from: 'codex',
      timestamp: '2026-01-01T00:08:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    const session = mockSession(tmpDir, { current_turn: 8 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.reviewLoopCount, 2);
    assert.deepEqual(result.pendingReviewDecided, { agent: 'codex', verdict: 'fix' });
  });

  it('ignores implement turns that do not follow review fix', async () => {
    // First implement turn (after plan consensus — no review fix before it)
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });

    const session = mockSession(tmpDir, { current_turn: 3 });
    const result = await recoverEphemeralState(session);
    assert.equal(result.reviewLoopCount, 0);
    assert.equal(result.pendingReviewDecided, null);
  });
});
