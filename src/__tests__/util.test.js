import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { atomicWrite, isProcessAlive } from '../util.js';

describe('atomicWrite', () => {
  let testDir;

  before(async () => {
    testDir = join(tmpdir(), `acb-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it('writes content to the target path', async () => {
    const filePath = join(testDir, 'test.txt');
    await atomicWrite(filePath, 'hello world');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, 'hello world');
  });

  it('does not leave .tmp file behind', async () => {
    const filePath = join(testDir, 'clean.txt');
    await atomicWrite(filePath, 'data');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(testDir);
    assert.ok(!files.some(f => f.endsWith('.tmp')), 'No .tmp files should remain');
  });

  it('overwrites existing file atomically', async () => {
    const filePath = join(testDir, 'overwrite.txt');
    await atomicWrite(filePath, 'first');
    await atomicWrite(filePath, 'second');
    const content = await readFile(filePath, 'utf8');
    assert.equal(content, 'second');
  });
});

describe('isProcessAlive', () => {
  it('returns true for current process', () => {
    assert.equal(isProcessAlive(process.pid), true);
  });

  it('returns false for a non-existent PID', () => {
    // PID 99999999 is extremely unlikely to exist
    assert.equal(isProcessAlive(99999999), false);
  });
});
