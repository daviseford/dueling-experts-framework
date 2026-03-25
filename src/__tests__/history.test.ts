import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { findSessionDir, listSessions } from '../session.js';

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
