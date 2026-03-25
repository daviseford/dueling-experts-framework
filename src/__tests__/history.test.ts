import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { findSessionDir, listSessions } from '../session.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeSessionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'default-id',
    topic: 'Default topic',
    mode: 'edit',
    max_turns: 20,
    target_repo: '/tmp',
    created: '2026-03-24T10:00:00.000Z',
    session_status: 'completed',
    current_turn: 5,
    next_agent: 'claude',
    phase: 'review',
    impl_model: 'claude',
    review_turns: 6,
    port: null,
    pid: 1234,
    worktree_path: null,
    branch_name: null,
    original_repo: null,
    base_ref: null,
    pr_url: null,
    pr_number: null,
    ...overrides,
  });
}

describe('findSessionDir', () => {
  let testRepo: string;

  before(async () => {
    testRepo = join(tmpdir(), `def-find-${randomUUID()}`);
    const sessionsDir = join(testRepo, '.def', 'sessions');
    await mkdir(join(sessionsDir, 'abc12345-0000-0000-0000-000000000000'), { recursive: true });
    await mkdir(join(sessionsDir, 'abc12345-0000-0000-0000-111111111111'), { recursive: true });
    await mkdir(join(sessionsDir, 'def99999-0000-0000-0000-000000000000'), { recursive: true });
  });

  after(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it('matches by unique prefix', async () => {
    const dir = await findSessionDir(testRepo, 'def99999');
    assert.ok(dir !== null);
    assert.ok(dir!.includes('def99999'));
  });

  it('returns null for ambiguous prefix', async () => {
    const dir = await findSessionDir(testRepo, 'abc12345');
    assert.equal(dir, null);
  });

  it('returns null for no match', async () => {
    const dir = await findSessionDir(testRepo, 'zzz');
    assert.equal(dir, null);
  });

  it('matches full UUID', async () => {
    const dir = await findSessionDir(testRepo, 'def99999-0000-0000-0000-000000000000');
    assert.ok(dir !== null);
  });

  it('returns null for nonexistent sessions dir', async () => {
    const dir = await findSessionDir(join(tmpdir(), 'nonexistent'), 'abc');
    assert.equal(dir, null);
  });
});

describe('listSessions', () => {
  let testRepo: string;

  before(async () => {
    testRepo = join(tmpdir(), `def-list-${randomUUID()}`);
    const sessionsDir = join(testRepo, '.def', 'sessions');

    const id1 = 'aaaa1111-0000-0000-0000-000000000000';
    const id2 = 'bbbb2222-0000-0000-0000-000000000000';
    const idCorrupt = 'cccc3333-0000-0000-0000-000000000000';

    await mkdir(join(sessionsDir, id1), { recursive: true });
    await mkdir(join(sessionsDir, id2), { recursive: true });
    await mkdir(join(sessionsDir, idCorrupt), { recursive: true });

    await writeFile(join(sessionsDir, id1, 'session.json'), makeSessionJson({
      id: id1,
      topic: 'First session',
      created: '2026-03-23T10:00:00.000Z',
      session_status: 'completed',
      branch_name: 'def/first',
      pr_url: 'https://github.com/test/repo/pull/42',
    }));
    await writeFile(join(sessionsDir, id2, 'session.json'), makeSessionJson({
      id: id2,
      topic: 'Second session',
      created: '2026-03-24T10:00:00.000Z',
      session_status: 'active',
    }));
    // Corrupt session — no session.json (just an empty dir)
  });

  after(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it('returns sorted sessions (newest first)', async () => {
    const sessions = await listSessions(testRepo);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].topic, 'Second session');
    assert.equal(sessions[1].topic, 'First session');
  });

  it('skips corrupted session directories', async () => {
    const sessions = await listSessions(testRepo);
    // Only 2 sessions (3rd dir has no session.json)
    assert.equal(sessions.length, 2);
  });

  it('includes branch and PR metadata', async () => {
    const sessions = await listSessions(testRepo);
    const first = sessions.find(s => s.topic === 'First session');
    assert.ok(first);
    assert.equal(first!.branch_name, 'def/first');
    assert.equal(first!.pr_url, 'https://github.com/test/repo/pull/42');
  });

  it('returns empty for nonexistent sessions dir', async () => {
    const sessions = await listSessions(join(tmpdir(), 'nonexistent'));
    assert.equal(sessions.length, 0);
  });
});

describe('listSessions liveness detection', () => {
  let testRepo: string;

  before(async () => {
    testRepo = join(tmpdir(), `def-liveness-${randomUUID()}`);
    const sessionsDir = join(testRepo, '.def', 'sessions');

    const idActive = 'live1111-0000-0000-0000-000000000000';
    const idDead = 'dead2222-0000-0000-0000-000000000000';
    const idStale = 'stale333-0000-0000-0000-000000000000';
    const idCompleted = 'done4444-0000-0000-0000-000000000000';

    for (const id of [idActive, idDead, idStale, idCompleted]) {
      await mkdir(join(sessionsDir, id), { recursive: true });
    }

    // Active session with live PID (current process) + fresh heartbeat
    await writeFile(join(sessionsDir, idActive, 'session.json'), makeSessionJson({
      id: idActive,
      topic: 'Active session',
      created: '2026-03-25T10:00:00.000Z',
      session_status: 'active',
      pid: process.pid,
    }));
    await writeFile(join(sessionsDir, idActive, 'heartbeat.json'), JSON.stringify({
      heartbeat_at: new Date().toISOString(),
    }));

    // Active session with dead PID (99999999)
    await writeFile(join(sessionsDir, idDead, 'session.json'), makeSessionJson({
      id: idDead,
      topic: 'Dead PID session',
      created: '2026-03-25T09:00:00.000Z',
      session_status: 'active',
      pid: 99999999,
    }));
    await writeFile(join(sessionsDir, idDead, 'heartbeat.json'), JSON.stringify({
      heartbeat_at: new Date().toISOString(),
    }));

    // Active session with stale heartbeat (>30s ago)
    await writeFile(join(sessionsDir, idStale, 'session.json'), makeSessionJson({
      id: idStale,
      topic: 'Stale heartbeat session',
      created: '2026-03-25T08:00:00.000Z',
      session_status: 'active',
      pid: process.pid,
    }));
    await writeFile(join(sessionsDir, idStale, 'heartbeat.json'), JSON.stringify({
      heartbeat_at: new Date(Date.now() - 60_000).toISOString(), // 60s ago
    }));

    // Completed session — is_active should be false regardless
    await writeFile(join(sessionsDir, idCompleted, 'session.json'), makeSessionJson({
      id: idCompleted,
      topic: 'Completed session',
      created: '2026-03-25T07:00:00.000Z',
      session_status: 'completed',
      pid: process.pid,
    }));
  });

  after(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it('active session with live PID + fresh heartbeat: is_active true', async () => {
    const sessions = await listSessions(testRepo);
    const s = sessions.find(s => s.topic === 'Active session');
    assert.ok(s);
    assert.equal(s!.is_active, true);
    assert.equal(s!.session_status, 'active');
  });

  it('active session with dead PID: reported as interrupted', async () => {
    const sessions = await listSessions(testRepo);
    const s = sessions.find(s => s.topic === 'Dead PID session');
    assert.ok(s);
    assert.equal(s!.is_active, false);
    assert.equal(s!.session_status, 'interrupted');
  });

  it('active session with stale heartbeat: reported as interrupted', async () => {
    const sessions = await listSessions(testRepo);
    const s = sessions.find(s => s.topic === 'Stale heartbeat session');
    assert.ok(s);
    assert.equal(s!.is_active, false);
    assert.equal(s!.session_status, 'interrupted');
  });

  it('completed session: is_active false regardless', async () => {
    const sessions = await listSessions(testRepo);
    const s = sessions.find(s => s.topic === 'Completed session');
    assert.ok(s);
    assert.equal(s!.is_active, false);
    assert.equal(s!.session_status, 'completed');
  });
});

describe('history --since/--before invalid date', () => {
  const indexPath = join(__dirname, '..', 'index.ts');

  function runHistory(args: string[]): Promise<{ code: number | null; stderr: string }> {
    return new Promise((resolve) => {
      const child = execFile(
        process.execPath,
        ['--import', 'tsx', indexPath, 'history', ...args],
        (err, _stdout, stderr) => {
          const code = child.exitCode ?? (err ? 1 : 0);
          resolve({ code, stderr });
        },
      );
    });
  }

  it('exits 1 with error message for invalid --since', async () => {
    const { code, stderr } = await runHistory(['--since', 'not-a-date']);
    assert.equal(code, 1);
    assert.ok(stderr.includes('Invalid date'), `Expected "Invalid date" in stderr, got: ${stderr}`);
  });

  it('exits 1 with error message for invalid --before', async () => {
    const { code, stderr } = await runHistory(['--before', 'garbage']);
    assert.equal(code, 1);
    assert.ok(stderr.includes('Invalid date'), `Expected "Invalid date" in stderr, got: ${stderr}`);
  });
});
