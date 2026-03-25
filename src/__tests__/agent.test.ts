import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildBareArgs } from '../agent.js';

describe('buildBareArgs', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'def-bare-test-'));
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Windows EPERM — best effort
    }
  });

  it('returns only --bare when no instruction files exist', async () => {
    const result = await buildBareArgs(testDir);
    assert.deepEqual(result, ['--bare']);
  });

  it('appends CLAUDE.md when only CLAUDE.md exists', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    const result = await buildBareArgs(testDir);
    const expected = ['--bare', '--append-system-prompt-file', join(testDir, 'CLAUDE.md')];
    assert.deepEqual(result, expected);
  });

  it('appends AGENTS.md when only AGENTS.md exists', async () => {
    await writeFile(join(testDir, 'AGENTS.md'), '# Agents', 'utf8');
    const result = await buildBareArgs(testDir);
    const expected = ['--bare', '--append-system-prompt-file', join(testDir, 'AGENTS.md')];
    assert.deepEqual(result, expected);
  });

  it('appends both files in order when both exist', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    await writeFile(join(testDir, 'AGENTS.md'), '# Agents', 'utf8');
    const result = await buildBareArgs(testDir);
    const expected = [
      '--bare',
      '--append-system-prompt-file', join(testDir, 'CLAUDE.md'),
      '--append-system-prompt-file', join(testDir, 'AGENTS.md'),
    ];
    assert.deepEqual(result, expected);
  });
});
