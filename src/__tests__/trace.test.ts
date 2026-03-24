import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Tracer, readEvents, listAttempts } from '../trace.js';

describe('Tracer', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-trace-test-${randomUUID()}`);
    await mkdir(join(sessionDir, 'artifacts', 'attempts'), { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('emits events to events.jsonl in order', async () => {
    const tracer = new Tracer(sessionDir);
    tracer.emit('session.start', { phase: 'plan', data: { topic: 'test' } });
    tracer.emit('turn.written', { turn: 1, agent: 'claude', phase: 'plan' });
    tracer.emit('session.end', { data: { turn_count: 1 } });
    await tracer.flush();

    const events = await readEvents(sessionDir);
    assert.equal(events.length, 3);
    assert.equal(events[0].event, 'session.start');
    assert.equal(events[0].seq, 0);
    assert.equal(events[1].event, 'turn.written');
    assert.equal(events[1].seq, 1);
    assert.equal(events[1].turn, 1);
    assert.equal(events[1].agent, 'claude');
    assert.equal(events[2].event, 'session.end');
    assert.equal(events[2].seq, 2);
  });

  it('readEvents filters by since parameter', async () => {
    const events = await readEvents(sessionDir);
    const since = events[0].ts;
    const filtered = await readEvents(sessionDir, since);
    assert.equal(filtered.length, 2); // events after the first
    assert.equal(filtered[0].event, 'turn.written');
  });

  it('saves attempt artifacts with prompt, output, and meta', async () => {
    const tracer = new Tracer(sessionDir);
    const meta = {
      turn: 1,
      agent: 'claude' as const,
      attempt_index: 0,
      phase: 'plan' as const,
      elapsed_ms: 5000,
      exit_code: 0,
      timed_out: false,
      cmd: 'claude',
      cwd: '/tmp/repo',
    };
    const dirName = await tracer.saveAttempt(1, 'claude', 0, '# prompt content', '# output content', meta);

    assert.equal(dirName, 'attempt-0001-claude-0');

    const attemptsDir = join(sessionDir, 'artifacts', 'attempts', dirName);
    const prompt = await readFile(join(attemptsDir, 'prompt.md'), 'utf8');
    assert.equal(prompt, '# prompt content');

    const output = await readFile(join(attemptsDir, 'output.md'), 'utf8');
    assert.equal(output, '# output content');

    const metaJson = JSON.parse(await readFile(join(attemptsDir, 'meta.json'), 'utf8'));
    assert.equal(metaJson.turn, 1);
    assert.equal(metaJson.agent, 'claude');
    assert.equal(metaJson.elapsed_ms, 5000);
    assert.equal(metaJson.exit_code, 0);
  });

  it('saves empty output as "(empty)"', async () => {
    const tracer = new Tracer(sessionDir);
    const meta = {
      turn: 2,
      agent: 'codex' as const,
      attempt_index: 0,
      phase: 'plan' as const,
      elapsed_ms: 1000,
      exit_code: 1,
      timed_out: false,
      cmd: 'codex',
      cwd: '/tmp/repo',
    };
    const dirName = await tracer.saveAttempt(2, 'codex', 0, 'prompt', '', meta);
    const output = await readFile(join(sessionDir, 'artifacts', 'attempts', dirName, 'output.md'), 'utf8');
    assert.equal(output, '(empty)');
  });

  it('listAttempts returns all attempt metadata', async () => {
    const attempts = await listAttempts(sessionDir);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].dir, 'attempt-0001-claude-0');
    assert.equal(attempts[1].dir, 'attempt-0002-codex-0');
  });

  it('readEvents returns empty array for missing events file', async () => {
    const emptyDir = join(tmpdir(), `def-trace-empty-${randomUUID()}`);
    await mkdir(emptyDir, { recursive: true });
    const events = await readEvents(emptyDir);
    assert.equal(events.length, 0);
    await rm(emptyDir, { recursive: true, force: true });
  });

  it('listAttempts returns empty array for missing attempts directory', async () => {
    const emptyDir = join(tmpdir(), `def-trace-empty2-${randomUUID()}`);
    await mkdir(emptyDir, { recursive: true });
    const attempts = await listAttempts(emptyDir);
    assert.equal(attempts.length, 0);
    await rm(emptyDir, { recursive: true, force: true });
  });
});
