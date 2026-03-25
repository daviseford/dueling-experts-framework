import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { assemble } from '../context.js';
import type { Session } from '../session.js';

function makeTurn(turn: number, from: string, content: string, decisions: string[] = []): string {
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

function makeSession(overrides: Partial<Session> & { topic: string; mode: string; next_agent: string; dir: string }): Session {
  return {
    id: 'test-session',
    max_turns: 20,
    target_repo: '/tmp',
    created: '2026-03-23T00:00:00.000Z',
    session_status: 'active',
    current_turn: 0,
    phase: 'plan',
    impl_model: 'claude',
    review_turns: 6,
    port: null,
    ...overrides,
  } as Session;
}

describe('assemble', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-test-${randomUUID()}`);
    await mkdir(join(sessionDir, 'turns'), { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('assembles a prompt with zero turns', async () => {
    const session = makeSession({
      topic: 'Test topic',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
    });
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

    const session = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
    });
    const prompt = await assemble(session);
    assert.ok(prompt.includes('## Prior Turns'));
    assert.ok(prompt.includes('Hello from Claude'));
    assert.ok(prompt.includes('Hello from Codex'));
    assert.ok(!prompt.includes('[Context truncated]'));
  });

  it('rejects unknown mode', async () => {
    const session = makeSession({ topic: 'T', mode: 'debate', next_agent: 'claude', dir: sessionDir });
    await assert.rejects(() => assemble(session), /Unknown mode/);
  });

  it('rejects unknown agent', async () => {
    const session = makeSession({ topic: 'T', mode: 'planning', next_agent: 'gpt4' as any, dir: sessionDir });
    await assert.rejects(() => assemble(session), /Unknown agent/);
  });

  it('injects persona for the correct agent', async () => {
    const session = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
      persona_claude: 'You are a security expert.',
    });
    const prompt = await assemble(session);
    assert.ok(prompt.includes('## Custom Instructions'));
    assert.ok(prompt.includes('You are a security expert.'));
  });

  it('does NOT inject persona for the other agent', async () => {
    const session = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
      persona_codex: 'Codex-only persona.',
    });
    const prompt = await assemble(session);
    assert.ok(!prompt.includes('## Custom Instructions'));
    assert.ok(!prompt.includes('Codex-only persona.'));
  });

  it('injects both personas independently', async () => {
    const sessionClaude = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
      persona_claude: 'Claude persona here.',
      persona_codex: 'Codex persona here.',
    });
    const promptClaude = await assemble(sessionClaude);
    assert.ok(promptClaude.includes('Claude persona here.'));
    assert.ok(!promptClaude.includes('Codex persona here.'));

    const sessionCodex = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'codex',
      dir: sessionDir,
      persona_claude: 'Claude persona here.',
      persona_codex: 'Codex persona here.',
    });
    const promptCodex = await assemble(sessionCodex);
    assert.ok(promptCodex.includes('Codex persona here.'));
    assert.ok(!promptCodex.includes('Claude persona here.'));
  });

  it('no persona means no Custom Instructions section', async () => {
    const session = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
    });
    const prompt = await assemble(session);
    assert.ok(!prompt.includes('## Custom Instructions'));
  });

  it('large persona counts against character budget', async () => {
    const largePersona = 'x'.repeat(300_000);
    const session = makeSession({
      topic: 'Test',
      mode: 'planning',
      next_agent: 'claude',
      dir: sessionDir,
      persona_claude: largePersona,
    });
    const prompt = await assemble(session);
    assert.ok(prompt.includes(largePersona));
  });
});
