import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  writeInterjection,
  readInterjections,
  writeEndRequest,
  checkEndRequest,
} from '../ipc.js';

describe('writeInterjection + readInterjections', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-ipc-${randomUUID()}`);
    await mkdir(sessionDir, { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('writes an interjection, reads it back, and deletes the file', async () => {
    await writeInterjection(sessionDir, 'hello from user');
    const contents = await readInterjections(sessionDir);
    assert.deepEqual(contents, ['hello from user']);

    // File should be consumed (deleted)
    const remaining = await readdir(join(sessionDir, 'interjections'));
    const jsonFiles = remaining.filter(f => f.endsWith('.json') && !f.endsWith('.tmp'));
    assert.equal(jsonFiles.length, 0, 'interjection files should be deleted after read');
  });

  it('returns multiple interjections in timestamp order', async () => {
    // Write with small delays to ensure distinct timestamps
    await writeInterjection(sessionDir, 'first');
    // Tiny delay to get a different timestamp
    await new Promise(r => setTimeout(r, 20));
    await writeInterjection(sessionDir, 'second');
    await new Promise(r => setTimeout(r, 20));
    await writeInterjection(sessionDir, 'third');

    const contents = await readInterjections(sessionDir);
    assert.deepEqual(contents, ['first', 'second', 'third']);
  });

  it('returns empty array when interjections directory does not exist', async () => {
    const emptySession = join(tmpdir(), `def-ipc-empty-${randomUUID()}`);
    await mkdir(emptySession, { recursive: true });
    try {
      const contents = await readInterjections(emptySession);
      assert.deepEqual(contents, []);
    } finally {
      await rm(emptySession, { recursive: true, force: true });
    }
  });

  it('concurrent writes produce separate files (no data loss)', async () => {
    const count = 10;
    const promises = Array.from({ length: count }, (_, i) =>
      writeInterjection(sessionDir, `concurrent-${i}`),
    );
    await Promise.all(promises);

    const contents = await readInterjections(sessionDir);
    assert.equal(contents.length, count, `should have ${count} interjections`);
    // Verify all messages are present (order may vary due to same-ms timestamps)
    const sorted = [...contents].sort();
    const expected = Array.from({ length: count }, (_, i) => `concurrent-${i}`).sort();
    assert.deepEqual(sorted, expected);
  });
});

describe('writeEndRequest + checkEndRequest', () => {
  let sessionDir: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-ipc-end-${randomUUID()}`);
    await mkdir(sessionDir, { recursive: true });
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('write end-requested, check returns true, subsequent check returns false', async () => {
    await writeEndRequest(sessionDir);
    const first = await checkEndRequest(sessionDir);
    assert.equal(first, true, 'first check should return true');

    const second = await checkEndRequest(sessionDir);
    assert.equal(second, false, 'second check should return false (file consumed)');
  });

  it('check returns false when no end-requested file exists', async () => {
    const result = await checkEndRequest(sessionDir);
    assert.equal(result, false);
  });
});
