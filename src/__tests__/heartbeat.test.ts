import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { atomicWrite } from '../util.js';
import { listSessions } from '../session.js';

describe('heartbeat.json format', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-heartbeat-${randomUUID()}`);
    await mkdir(sessionDir, { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('writes valid JSON with heartbeat_at timestamp', async () => {
    const heartbeatPath = join(sessionDir, 'heartbeat.json');
    const payload = JSON.stringify({ heartbeat_at: new Date().toISOString() }) + '\n';
    await atomicWrite(heartbeatPath, payload);

    const raw = await readFile(heartbeatPath, 'utf8');
    const data = JSON.parse(raw);
    assert.ok(data.heartbeat_at, 'heartbeat_at should be present');
    // Verify it's a valid ISO date
    const date = new Date(data.heartbeat_at);
    assert.ok(!isNaN(date.getTime()), 'heartbeat_at should be a valid ISO date');
  });

  it('overwrites previous heartbeat atomically', async () => {
    const heartbeatPath = join(sessionDir, 'heartbeat.json');

    const first = new Date('2026-01-01T00:00:00.000Z').toISOString();
    await atomicWrite(heartbeatPath, JSON.stringify({ heartbeat_at: first }) + '\n');

    const second = new Date('2026-01-01T00:00:10.000Z').toISOString();
    await atomicWrite(heartbeatPath, JSON.stringify({ heartbeat_at: second }) + '\n');

    const raw = await readFile(heartbeatPath, 'utf8');
    const data = JSON.parse(raw);
    assert.equal(data.heartbeat_at, second, 'should contain the latest heartbeat');
  });
});

describe('stale session reconciliation in listSessions()', () => {
  let tempRepo: string;

  before(async () => {
    tempRepo = join(tmpdir(), `def-reconcile-${randomUUID()}`);
    await mkdir(join(tempRepo, '.def', 'sessions'), { recursive: true });
  });

  after(async () => {
    await rm(tempRepo, { recursive: true, force: true });
  });

  it('reconciles active session with dead PID to interrupted on disk', async () => {
    const sessionId = randomUUID();
    const sessionDir = join(tempRepo, '.def', 'sessions', sessionId);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    await mkdir(join(sessionDir, 'runtime'), { recursive: true });

    // Write session.json with active status and a PID that does not exist
    const sessionData = {
      id: sessionId,
      topic: 'test reconciliation',
      mode: 'edit',
      max_turns: 10,
      target_repo: tempRepo,
      created: new Date().toISOString(),
      session_status: 'active',
      current_turn: 1,
      next_agent: 'claude',
      phase: 'plan',
      impl_model: 'claude',
      review_turns: 6,
      port: null,
      pid: 999999,
      worktree_path: null,
      branch_name: null,
      original_repo: null,
      base_ref: null,
      pr_url: null,
      pr_number: null,
      roster: [{ id: 'claude', provider: 'claude', role: 'planner', model: 'claude' }],
    };
    await atomicWrite(join(sessionDir, 'session.json'), JSON.stringify(sessionData, null, 2) + '\n');

    // Write a stale heartbeat (old timestamp)
    const staleHeartbeat = new Date(Date.now() - 60_000).toISOString();
    await atomicWrite(join(sessionDir, 'heartbeat.json'), JSON.stringify({ heartbeat_at: staleHeartbeat }) + '\n');

    // Call listSessions — this should reconcile the stale session
    const sessions = await listSessions(tempRepo);

    // The returned summary should show interrupted
    const found = sessions.find(s => s.id === sessionId);
    assert.ok(found, 'session should appear in list');
    assert.equal(found.session_status, 'interrupted', 'returned status should be interrupted');

    // Read session.json back from disk — it should be reconciled
    const rawAfter = await readFile(join(sessionDir, 'session.json'), 'utf8');
    const dataAfter = JSON.parse(rawAfter);
    assert.equal(dataAfter.session_status, 'interrupted', 'on-disk status should be reconciled to interrupted');
  });

  it('does not modify a completed session', async () => {
    const sessionId = randomUUID();
    const sessionDir = join(tempRepo, '.def', 'sessions', sessionId);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    await mkdir(join(sessionDir, 'runtime'), { recursive: true });

    const sessionData = {
      id: sessionId,
      topic: 'completed session',
      mode: 'edit',
      max_turns: 10,
      target_repo: tempRepo,
      created: new Date().toISOString(),
      session_status: 'completed',
      current_turn: 5,
      next_agent: 'claude',
      phase: 'plan',
      impl_model: 'claude',
      review_turns: 6,
      port: null,
      pid: 999999,
      worktree_path: null,
      branch_name: null,
      original_repo: null,
      base_ref: null,
      pr_url: null,
      pr_number: null,
      roster: [{ id: 'claude', provider: 'claude', role: 'planner', model: 'claude' }],
    };
    await atomicWrite(join(sessionDir, 'session.json'), JSON.stringify(sessionData, null, 2) + '\n');

    // Call listSessions
    const sessions = await listSessions(tempRepo);

    const found = sessions.find(s => s.id === sessionId);
    assert.ok(found, 'session should appear in list');
    assert.equal(found.session_status, 'completed', 'returned status should remain completed');

    // Verify on-disk status was NOT changed
    const rawAfter = await readFile(join(sessionDir, 'session.json'), 'utf8');
    const dataAfter = JSON.parse(rawAfter);
    assert.equal(dataAfter.session_status, 'completed', 'on-disk status should remain completed');
  });
});
