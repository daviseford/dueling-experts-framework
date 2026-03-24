import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yaml from 'js-yaml';
import { run } from '../orchestrator.js';
import { readEvents, listAttempts } from '../trace.js';
import type { Session } from '../session.js';

/**
 * Helper: write a session.json file for the given session object.
 */
async function writeSessionJson(session: Session): Promise<void> {
  await writeFile(
    join(session.dir, 'session.json'),
    JSON.stringify(session, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Helper: write a turn file with frontmatter and body.
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
 * Create a minimal session suitable for recovery tests.
 * Uses mode: 'edit' so that the shared finalization path exercises
 * worktree cleanup and target_repo restoration.
 */
function makeSession(dir: string, overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-recovery-finalize',
    topic: 'test topic',
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

describe('recovery finalization', () => {
  let tmpDir: string;
  let turnsDir: string;
  let originalRepo: string;
  let worktreePath: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'def-recovery-finalize-'));
    turnsDir = join(tmpDir, 'turns');
    await mkdir(turnsDir, { recursive: true });
    await mkdir(join(tmpDir, 'runtime'), { recursive: true });
    // Separate directories for edit-mode worktree simulation.
    // These are not real git repos — worktree/commit operations fail silently
    // in the finalization path's try/catch blocks.
    originalRepo = await mkdtemp(join(tmpdir(), 'def-orig-'));
    worktreePath = await mkdtemp(join(tmpdir(), 'def-wt-'));
  });

  afterEach(async () => {
    // Best-effort cleanup — Windows CI may hold file locks after child process exit
    for (const dir of [tmpDir, originalRepo, worktreePath]) {
      try { await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    }
  });

  it('recovery-approve runs shared finalization: decisions, trace, target_repo restoration', async () => {
    // Set up a recovered edit-mode session where the reviewer approved
    // before interruption. Finalization should generate decisions,
    // restore target_repo, and emit terminal trace events.
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
      decisions: ['Use event logging for debuggability'],
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
      decisions: ['Add attempt artifacts'],
    });
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'approve',
    });

    const session = makeSession(tmpDir, {
      current_turn: 4,
      phase: 'review',
      target_repo: worktreePath,
      worktree_path: worktreePath,
      original_repo: originalRepo,
      branch_name: 'def/test-branch',
      base_ref: 'main',
    });
    await writeSessionJson(session);

    await run(session, { noPr: true });

    // 1. events.jsonl should have session.start AND session.end
    const events = await readEvents(tmpDir);
    const eventTypes = events.map((e: { event: string }) => e.event);
    assert.ok(eventTypes.includes('session.start'), 'missing session.start event');
    assert.ok(eventTypes.includes('session.end'), 'missing session.end event');

    // 2. session.json should be completed with target_repo restored to original_repo
    const finalSession = JSON.parse(await readFile(join(tmpDir, 'session.json'), 'utf8'));
    assert.equal(finalSession.session_status, 'completed');
    assert.equal(finalSession.target_repo, originalRepo, 'target_repo not restored to original_repo');

    // 3. decisions.md should exist (finalization ran generateDecisions)
    const decisionsPath = join(tmpDir, 'artifacts', 'decisions.md');
    const decisionsContent = await readFile(decisionsPath, 'utf8');
    assert.ok(decisionsContent.includes('Use event logging'), 'decisions.md missing expected content');
    assert.ok(decisionsContent.includes('Add attempt artifacts'), 'decisions.md missing expected content');
  });

  it('recovery-review-limit runs shared finalization: decisions, trace, target_repo restoration', async () => {
    // Set up a recovered edit-mode session where the review loop limit
    // is exceeded. Finalization should run the same shared path.
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
      decisions: ['Serialize event writes'],
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    // First review: fix
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });
    // Implement after fix
    await writeTurn(turnsDir, {
      id: 'turn-0005-claude', turn: 5, from: 'claude',
      timestamp: '2026-01-01T00:05:00Z', status: 'complete', phase: 'implement',
    });
    // Second review: fix again — this exceeds review_turns: 1
    await writeTurn(turnsDir, {
      id: 'turn-0006-codex', turn: 6, from: 'codex',
      timestamp: '2026-01-01T00:06:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    // review_turns: 1 means after 1 completed fix cycle the next fix is the limit
    const session = makeSession(tmpDir, {
      current_turn: 6,
      phase: 'review',
      review_turns: 1,
      target_repo: worktreePath,
      worktree_path: worktreePath,
      original_repo: originalRepo,
      branch_name: 'def/test-branch',
      base_ref: 'main',
    });
    await writeSessionJson(session);

    await run(session, { noPr: true });

    // 1. events.jsonl should have both terminal events
    const events = await readEvents(tmpDir);
    const eventTypes = events.map((e: { event: string }) => e.event);
    assert.ok(eventTypes.includes('session.start'), 'missing session.start event');
    assert.ok(eventTypes.includes('session.end'), 'missing session.end event');

    // 2. session.json should be completed with target_repo restored
    const finalSession = JSON.parse(await readFile(join(tmpDir, 'session.json'), 'utf8'));
    assert.equal(finalSession.session_status, 'completed');
    assert.equal(finalSession.target_repo, originalRepo, 'target_repo not restored to original_repo');

    // 3. decisions.md should exist
    const decisionsPath = join(tmpDir, 'artifacts', 'decisions.md');
    const decisionsContent = await readFile(decisionsPath, 'utf8');
    assert.ok(decisionsContent.includes('Serialize event writes'), 'decisions.md missing expected content');
  });

  it('attempt counters are scoped per-session, not shared across concurrent runs', { timeout: 30_000 }, async () => {
    // Regression: attemptCounters was module-global. Even clearing on entry
    // would break concurrent runs. Now the counter map is local to run(),
    // so two sessions in the same process each start at attempt_index 0.

    // --- Session A: recovery-approve path (no loop, just finalization) ---
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
      decisions: ['Decision A'],
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'approve',
    });

    const sessionA = makeSession(tmpDir, {
      current_turn: 4,
      phase: 'review',
      target_repo: worktreePath,
      worktree_path: worktreePath,
      original_repo: originalRepo,
      branch_name: 'def/test-branch',
      base_ref: 'main',
    });
    await writeSessionJson(sessionA);

    // --- Session B: fix-under-limit path (enters loop, spawns agent) ---
    const tmpDir2 = await mkdtemp(join(tmpdir(), 'def-recovery-counter-'));
    const turnsDir2 = join(tmpDir2, 'turns');
    await mkdir(turnsDir2, { recursive: true });
    await mkdir(join(tmpDir2, 'runtime'), { recursive: true });
    const originalRepo2 = await mkdtemp(join(tmpdir(), 'def-orig2-'));

    await writeTurn(turnsDir2, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
      decisions: ['Decision B'],
    });
    await writeTurn(turnsDir2, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir2, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    await writeTurn(turnsDir2, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    const nonExistentWorktree = join(tmpDir2, 'nonexistent-worktree');
    const sessionB = makeSession(tmpDir2, {
      id: 'test-recovery-counter-2',
      current_turn: 4,
      phase: 'review',
      review_turns: 6,
      max_turns: 10,
      target_repo: nonExistentWorktree,
      worktree_path: nonExistentWorktree,
      original_repo: originalRepo2,
      branch_name: 'def/test-branch-2',
      base_ref: 'main',
    });
    await writeSessionJson(sessionB);

    // Run both sessions sequentially (same process)
    await run(sessionA, { noPr: true });
    await run(sessionB, { noPr: true });

    // KEY ASSERTION: Session B's first attempt should be index 0.
    // With the old module-global counter, session A's finalization or any
    // other state would contaminate session B's numbering.
    const attemptsB = await listAttempts(tmpDir2);
    assert.ok(attemptsB.length > 0, 'session B should have at least one attempt');
    assert.equal(attemptsB[0].attempt_index, 0,
      'attempt counter leaked across sessions — first attempt should be index 0');

    // Best-effort cleanup — Windows CI may hold file locks
    try { await rm(tmpDir2, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
    try { await rm(originalRepo2, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch {}
  });

  it('recovery-fix-under-limit enters the main loop and finalizes', { timeout: 30_000 }, async () => {
    // Set up a recovered edit-mode session with a pending fix verdict
    // under the review limit. The recovery code must NOT set endRequested,
    // allowing the main loop to run. We use a non-existent worktree path
    // as target_repo so the agent spawn fails immediately (ENOENT on cwd),
    // but the loop entry is proven by the attempt.start event.
    await writeTurn(turnsDir, {
      id: 'turn-0001-claude', turn: 1, from: 'claude',
      timestamp: '2026-01-01T00:01:00Z', status: 'decided', phase: 'plan',
      decisions: ['Capture attempts'],
    });
    await writeTurn(turnsDir, {
      id: 'turn-0002-codex', turn: 2, from: 'codex',
      timestamp: '2026-01-01T00:02:00Z', status: 'decided', phase: 'plan',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0003-claude', turn: 3, from: 'claude',
      timestamp: '2026-01-01T00:03:00Z', status: 'complete', phase: 'implement',
    });
    await writeTurn(turnsDir, {
      id: 'turn-0004-codex', turn: 4, from: 'codex',
      timestamp: '2026-01-01T00:04:00Z', status: 'decided', phase: 'review',
      verdict: 'fix',
    });

    // Non-existent directory: agent spawn will fail immediately with ENOENT
    const nonExistentWorktree = join(tmpDir, 'nonexistent-worktree');

    const session = makeSession(tmpDir, {
      current_turn: 4,
      phase: 'review',
      review_turns: 6,
      max_turns: 10, // Higher than current_turn so the loop is reachable
      target_repo: nonExistentWorktree,
      worktree_path: nonExistentWorktree,
      original_repo: originalRepo,
      branch_name: 'def/test-branch',
      base_ref: 'main',
    });
    await writeSessionJson(session);

    await run(session, { noPr: true });

    const events = await readEvents(tmpDir);
    const eventTypes = events.map((e: { event: string }) => e.event);

    // KEY: attempt.start proves the main loop was entered (not skipped via endRequested)
    assert.ok(eventTypes.includes('attempt.start'), 'missing attempt.start — loop was not entered');

    // phase.changed must appear for the recovery review→implement transition
    const phaseChanged = events.find(
      (e: { event: string; data?: Record<string, unknown> }) =>
        e.event === 'phase.changed' && e.data?.from_phase === 'review' && e.data?.to_phase === 'implement',
    );
    assert.ok(phaseChanged, 'missing phase.changed event for recovery review→implement transition');
    assert.equal((phaseChanged as { data: Record<string, unknown> }).data.recovery, true,
      'recovery phase.changed should have recovery: true in data');

    // Finalization still ran after the loop broke on agent failure
    assert.ok(eventTypes.includes('session.end'), 'missing session.end — finalization did not run');

    // session.json should be completed with target_repo restored
    const finalSession = JSON.parse(await readFile(join(tmpDir, 'session.json'), 'utf8'));
    assert.equal(finalSession.session_status, 'completed');
    assert.equal(finalSession.target_repo, originalRepo, 'target_repo not restored to original_repo');
  });
});
