import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assemble } from '../context.js';

function makeTurn(turn, from, content, decisions = []) {
  const decLine = decisions.length > 0
    ? `decisions:\n${decisions.map(d => `  - ${d}`).join('\n')}\n`
    : '';
  return [
    '---',
    `id: turn-${String(turn).padStart(4, '0')}-${from}`,
    `turn: ${turn}`,
    `from: ${from}`,
    `timestamp: 2026-03-23T14:00:00.000Z`,
    `status: complete`,
    decLine.trimEnd(),
    '---',
    content,
  ].filter(Boolean).join('\n');
}

describe('assemble', () => {
  let sessionDir;

  before(async () => {
    sessionDir = join(tmpdir(), `acb-test-${randomUUID()}`);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('assembles a prompt with zero turns', async () => {
    const session = {
      topic: 'Test topic',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
    };
    const prompt = await assemble(session);
    assert.ok(prompt.includes('Test topic'));
    assert.ok(prompt.includes('You are Claude'));
    assert.ok(prompt.includes('## Your Turn'));
    assert.ok(!prompt.includes('## Prior Turns'));
  });

  it('includes turns when within budget', async () => {
    const turnsDir = join(sessionDir, 'turns');
    await writeFile(join(turnsDir, 'turn-0001-claude.md'), makeTurn(1, 'claude', 'Hello from Claude'));
    await writeFile(join(turnsDir, 'turn-0002-codex.md'), makeTurn(2, 'codex', 'Hello from Codex'));

    const session = {
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
    };
    const prompt = await assemble(session);
    assert.ok(prompt.includes('## Prior Turns'));
    assert.ok(prompt.includes('Hello from Claude'));
    assert.ok(prompt.includes('Hello from Codex'));
    assert.ok(!prompt.includes('[Context truncated]'));
  });

  it('rejects unknown mode', async () => {
    const session = { topic: 'T', mode: 'debate', next_agent: 'claude', dir: sessionDir };
    await assert.rejects(() => assemble(session), /Unknown mode/);
  });

  it('rejects unknown agent', async () => {
    const session = { topic: 'T', mode: 'planning', next_agent: 'gpt4', dir: sessionDir };
    await assert.rejects(() => assemble(session), /Unknown agent/);
  });
});
