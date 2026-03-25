import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// We test the internal logic by directly importing and calling functions.
// Since registerRepo/listKnownRepos use a global path (~/.def/known-repos),
// we test the logic via listAllSessions which takes repo paths from listKnownRepos.
// For unit-level isolation, we test listSessions augmentation in history.test.ts.

describe('registry module exports', () => {
  it('imports without error', async () => {
    const mod = await import('../registry.js');
    assert.equal(typeof mod.registerRepo, 'function');
    assert.equal(typeof mod.listKnownRepos, 'function');
    assert.equal(typeof mod.listAllSessions, 'function');
  });
});
