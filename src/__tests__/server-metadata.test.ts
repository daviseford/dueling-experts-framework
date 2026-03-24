import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { getSessionMetadata } from '../server.js';

describe('getSessionMetadata', () => {
  let sessionDir: string;
  let sessionPath: string;

  before(async () => {
    sessionDir = join(tmpdir(), `def-server-meta-${randomUUID()}`);
    await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
    sessionPath = join(sessionDir, 'session.json');
  });

  after(async () => {
    await rm(sessionDir, { recursive: true, force: true });
  });

  it('returns defaults when session.json does not exist', async () => {
    const meta = await getSessionMetadata(join(sessionDir, 'nonexistent.json'));
    assert.equal(meta.sessionStatus, 'active');
    assert.equal(meta.phase, null);
    assert.equal(meta.branchName, null);
    assert.equal(meta.prUrl, null);
    assert.equal(meta.prNumber, null);
    assert.deepEqual(meta.artifactNames, []);
  });

  it('returns all metadata fields from a completed session', async () => {
    await writeFile(sessionPath, JSON.stringify({
      session_status: 'completed',
      phase: 'implement',
      branch_name: 'def/abc12345-test',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    }));
    await writeFile(join(sessionDir, 'artifacts', 'decisions.md'), '1. test decision\n');
    await writeFile(join(sessionDir, 'artifacts', 'pr-body.md'), 'test body\n');

    const meta = await getSessionMetadata(sessionPath);
    assert.equal(meta.sessionStatus, 'completed');
    assert.equal(meta.phase, 'implement');
    assert.equal(meta.branchName, 'def/abc12345-test');
    assert.equal(meta.prUrl, 'https://github.com/org/repo/pull/42');
    assert.equal(meta.prNumber, 42);
    assert.ok(meta.artifactNames.includes('decisions.md'));
    assert.ok(meta.artifactNames.includes('pr-body.md'));
  });

  it('returns null defaults for missing optional fields in session.json', async () => {
    await writeFile(sessionPath, JSON.stringify({
      session_status: 'active',
    }));

    const meta = await getSessionMetadata(sessionPath);
    assert.equal(meta.sessionStatus, 'active');
    assert.equal(meta.phase, null);
    assert.equal(meta.branchName, null);
    assert.equal(meta.prUrl, null);
    assert.equal(meta.prNumber, null);
  });

  it('filters dotfiles from artifact names', async () => {
    await writeFile(join(sessionDir, 'artifacts', '.hidden'), 'hidden');
    await writeFile(sessionPath, JSON.stringify({ session_status: 'completed' }));

    const meta = await getSessionMetadata(sessionPath);
    assert.ok(!meta.artifactNames.includes('.hidden'));
  });
});
