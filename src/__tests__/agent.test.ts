import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
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

  it('appends CLAUDE.md when it exists', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    const result = await buildBareArgs(testDir);
    assert.equal(result[0], '--bare');
    assert.equal(result[1], '--append-system-prompt-file');
    assert.ok(result[2].endsWith('CLAUDE.md'));
    assert.equal(result.length, 3);
  });

  it('appends both files when both exist', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    await writeFile(join(testDir, 'AGENTS.md'), '# Agents', 'utf8');
    const result = await buildBareArgs(testDir);
    assert.equal(result[0], '--bare');
    assert.equal(result[1], '--append-system-prompt-file');
    assert.ok(result[2].endsWith('CLAUDE.md'));
    assert.equal(result[3], '--append-system-prompt-file');
    assert.ok(result[4].endsWith('AGENTS.md'));
    assert.equal(result.length, 5);
  });

  it('returns absolute paths', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    await writeFile(join(testDir, 'AGENTS.md'), '# Agents', 'utf8');
    const result = await buildBareArgs(testDir);
    // Every path argument (indices 2 and 4) must be absolute
    assert.ok(isAbsolute(result[2]), `expected absolute path, got: ${result[2]}`);
    assert.ok(isAbsolute(result[4]), `expected absolute path, got: ${result[4]}`);
  });

  it('skips AGENTS.md when only CLAUDE.md exists', async () => {
    await writeFile(join(testDir, 'CLAUDE.md'), '# Instructions', 'utf8');
    const result = await buildBareArgs(testDir);
    assert.ok(!result.some(a => a.endsWith('AGENTS.md')));
  });
});
