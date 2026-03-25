import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { exportMarkdown, exportHtml } from '../export.js';
import { findSessionDir, listSessions } from '../session.js';

function makeSessionJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'test-session-id',
    topic: 'Test topic',
    mode: 'edit',
    max_turns: 20,
    target_repo: '/tmp',
    created: '2026-03-24T10:00:00.000Z',
    session_status: 'completed',
    current_turn: 3,
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

function makeTurn(turn: number, from: string, content: string): string {
  return [
    '---',
    `id: turn-${String(turn).padStart(4, '0')}-${from}`,
    `turn: ${turn}`,
    `from: ${from}`,
    `timestamp: 2026-03-24T1${turn}:00:00.000Z`,
    'status: complete',
    '---',
    content,
  ].join('\n');
}

describe('exportMarkdown', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-export-test-${randomUUID()}`);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    await writeFile(join(sessionDir, 'session.json'), makeSessionJson());
    await writeFile(join(sessionDir, 'turns', 'turn-0001-claude.md'), makeTurn(1, 'claude', 'Hello from Claude'));
    await writeFile(join(sessionDir, 'turns', 'turn-0002-codex.md'), makeTurn(2, 'codex', 'Hello from Codex'));
    await writeFile(join(sessionDir, 'turns', 'turn-0003-claude.md'), makeTurn(3, 'claude', 'Final response'));
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('produces valid output with header and turns', async () => {
    const md = await exportMarkdown(sessionDir);
    assert.ok(md.includes('# Test topic'));
    assert.ok(md.includes('test-session-id'));
    assert.ok(md.includes('Turn 1 -- claude'));
    assert.ok(md.includes('Turn 2 -- codex'));
    assert.ok(md.includes('Turn 3 -- claude'));
    assert.ok(md.includes('Hello from Claude'));
    assert.ok(md.includes('Hello from Codex'));
  });

  it('includes decisions appendix', async () => {
    await writeFile(join(sessionDir, 'artifacts', 'decisions.md'), '1. Use TypeScript\n2. No new deps');
    const md = await exportMarkdown(sessionDir);
    assert.ok(md.includes('## Appendix: Decisions'));
    assert.ok(md.includes('Use TypeScript'));
  });

  it('handles empty session (0 turns)', async () => {
    const emptyDir = join(tmpdir(), `def-export-empty-${randomUUID()}`);
    await mkdir(join(emptyDir, 'turns'), { recursive: true });
    await mkdir(join(emptyDir, 'artifacts'), { recursive: true });
    await writeFile(join(emptyDir, 'session.json'), makeSessionJson({ topic: 'Empty' }));

    const md = await exportMarkdown(emptyDir);
    assert.ok(md.includes('# Empty'));
    assert.ok(md.includes('**Turns:** 0'));
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('handles corrupted turns', async () => {
    const corruptDir = join(tmpdir(), `def-export-corrupt-${randomUUID()}`);
    await mkdir(join(corruptDir, 'turns'), { recursive: true });
    await mkdir(join(corruptDir, 'artifacts'), { recursive: true });
    await writeFile(join(corruptDir, 'session.json'), makeSessionJson());
    await writeFile(join(corruptDir, 'turns', 'turn-0001-claude.md'), 'No frontmatter here');

    const md = await exportMarkdown(corruptDir);
    assert.ok(md.includes('Turn (corrupted)'));
    assert.ok(md.includes('No frontmatter here'));
    await rm(corruptDir, { recursive: true, force: true });
  });
});

describe('exportHtml', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-html-test-${randomUUID()}`);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    await writeFile(join(sessionDir, 'session.json'), makeSessionJson());
    await writeFile(join(sessionDir, 'turns', 'turn-0001-claude.md'), makeTurn(1, 'claude', 'Hello'));
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('produces self-contained HTML', async () => {
    const html = await exportHtml(sessionDir);
    assert.ok(html.startsWith('<!DOCTYPE html>'));
    assert.ok(html.includes('<style>'));
    assert.ok(!html.includes('href="http'));
    assert.ok(!html.includes('src="http'));
  });

  it('escapes HTML in turn content', async () => {
    const xssDir = join(tmpdir(), `def-html-xss-${randomUUID()}`);
    await mkdir(join(xssDir, 'turns'), { recursive: true });
    await mkdir(join(xssDir, 'artifacts'), { recursive: true });
    await writeFile(join(xssDir, 'session.json'), makeSessionJson());
    await writeFile(join(xssDir, 'turns', 'turn-0001-claude.md'), makeTurn(1, 'claude', '<script>alert("xss")</script>'));

    const html = await exportHtml(xssDir);
    assert.ok(!html.includes('<script>alert'));
    assert.ok(html.includes('&lt;script&gt;'));
    await rm(xssDir, { recursive: true, force: true });
  });
});

describe('findSessionDir', () => {
  let testRepo: string;

  before(async () => {
    testRepo = join(tmpdir(), `def-find-test-${randomUUID()}`);
    const sessionsDir = join(testRepo, '.def', 'sessions');
    await mkdir(join(sessionsDir, 'abc12345-6789-0000-0000-000000000000'), { recursive: true });
    await mkdir(join(sessionsDir, 'abc12345-6789-0000-0000-111111111111'), { recursive: true });
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
});

describe('listSessions', () => {
  let testRepo: string;

  before(async () => {
    testRepo = join(tmpdir(), `def-list-test-${randomUUID()}`);
    const sessionsDir = join(testRepo, '.def', 'sessions');

    const id1 = 'aaaa1111-0000-0000-0000-000000000000';
    const id2 = 'bbbb2222-0000-0000-0000-000000000000';
    await mkdir(join(sessionsDir, id1), { recursive: true });
    await mkdir(join(sessionsDir, id2), { recursive: true });

    await writeFile(join(sessionsDir, id1, 'session.json'), makeSessionJson({
      id: id1, topic: 'First', created: '2026-03-23T10:00:00.000Z',
    }));
    await writeFile(join(sessionsDir, id2, 'session.json'), makeSessionJson({
      id: id2, topic: 'Second', created: '2026-03-24T10:00:00.000Z',
    }));
  });

  after(async () => {
    await rm(testRepo, { recursive: true, force: true });
  });

  it('returns sorted sessions (newest first)', async () => {
    const sessions = await listSessions(testRepo);
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].topic, 'Second');
    assert.equal(sessions[1].topic, 'First');
  });

  it('returns empty for nonexistent sessions dir', async () => {
    const sessions = await listSessions(join(tmpdir(), 'nonexistent'));
    assert.equal(sessions.length, 0);
  });
});
