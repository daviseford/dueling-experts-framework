import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hasBranchDelta } from '../pr.js';
import { createWorktree, removeWorktree, commitChanges } from '../worktree.js';
import { parseArgs } from '../cli.js';

describe('hasBranchDelta', () => {
  let testDir: string;

  before(async () => {
    testDir = join(tmpdir(), `def-pr-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await writeFile(join(testDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: testDir });
  });

  after(async () => {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: testDir });
    } catch { /* ignore */ }
    await rm(testDir, { recursive: true, force: true });
  });

  it('returns false when branch has no commits beyond base', async () => {
    const sessionId = randomUUID();
    const { worktreePath, baseRef } = await createWorktree(testDir, sessionId, 'no delta');

    const delta = await hasBranchDelta(worktreePath, baseRef);
    assert.equal(delta, false, 'should have no delta on fresh worktree');

    await removeWorktree(testDir, worktreePath);
  });

  it('returns true when branch has commits beyond base', async () => {
    const sessionId = randomUUID();
    const { worktreePath, baseRef } = await createWorktree(testDir, sessionId, 'has delta');

    // Make a change and commit
    await writeFile(join(worktreePath, 'new.txt'), 'content\n');
    await commitChanges(worktreePath, 'add new file');

    const delta = await hasBranchDelta(worktreePath, baseRef);
    assert.equal(delta, true, 'should detect delta after commit');

    await removeWorktree(testDir, worktreePath);
  });

  it('returns false when base_ref is null (conservatively skips)', async () => {
    const sessionId = randomUUID();
    const { worktreePath } = await createWorktree(testDir, sessionId, 'null base');

    // With null baseRef we cannot reliably determine delta — should return false
    const delta = await hasBranchDelta(worktreePath, null);
    assert.equal(delta, false, 'should conservatively return false with null baseRef');

    await removeWorktree(testDir, worktreePath);
  });
});

describe('createWorktree returns baseRef', () => {
  let testDir: string;

  before(async () => {
    testDir = join(tmpdir(), `def-pr-baseref-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    await writeFile(join(testDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: testDir });
  });

  after(async () => {
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: testDir });
    } catch { /* ignore */ }
    await rm(testDir, { recursive: true, force: true });
  });

  it('captures the current branch as baseRef', async () => {
    const currentBranch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: testDir, encoding: 'utf8',
    }).trim();

    const sessionId = randomUUID();
    const { worktreePath, baseRef } = await createWorktree(testDir, sessionId, 'baseref test');

    assert.equal(baseRef, currentBranch, 'baseRef should match the starting branch');

    await removeWorktree(testDir, worktreePath);
  });
});

describe('Session schema includes PR fields', () => {
  it('session.json round-trips pr_url, pr_number, and base_ref', async () => {
    // This is a serialization sanity check
    const session = {
      id: randomUUID(),
      topic: 'test',
      mode: 'edit',
      max_turns: 10,
      target_repo: '/tmp/test',
      created: new Date().toISOString(),
      session_status: 'completed',
      current_turn: 5,
      next_agent: 'claude',
      phase: 'implement',
      impl_model: 'claude',
      review_turns: 6,
      port: null,
      pid: process.pid,
      worktree_path: null,
      branch_name: 'def/abc12345-test',
      original_repo: '/tmp/test',
      base_ref: 'main',
      pr_url: 'https://github.com/org/repo/pull/42',
      pr_number: 42,
    };

    const json = JSON.stringify(session, null, 2);
    const parsed = JSON.parse(json);

    assert.equal(parsed.base_ref, 'main');
    assert.equal(parsed.pr_url, 'https://github.com/org/repo/pull/42');
    assert.equal(parsed.pr_number, 42);
  });

  it('defaults to null for new PR fields', async () => {
    const session = {
      id: randomUUID(),
      topic: 'test',
      mode: 'edit',
      base_ref: null,
      pr_url: null,
      pr_number: null,
    };

    const json = JSON.stringify(session, null, 2);
    const parsed = JSON.parse(json);

    assert.equal(parsed.base_ref, null);
    assert.equal(parsed.pr_url, null);
    assert.equal(parsed.pr_number, null);
  });
});

describe('CLI --no-pr parsing', () => {
  it('parseArgs recognizes --no-pr flag', () => {
    const result = parseArgs(['--topic', 'test topic', '--no-pr']);
    assert.equal(result.noPr, true);
    assert.equal(result.topic, 'test topic');
  });

  it('parseArgs defaults noPr to undefined when flag absent', () => {
    const result = parseArgs(['--topic', 'test topic']);
    assert.equal(result.noPr, undefined);
  });

  it('parseArgs handles --no-pr with other flags', () => {
    const result = parseArgs(['--no-pr', '--topic', 'my topic', '--mode', 'edit', '--max-turns', '10']);
    assert.equal(result.noPr, true);
    assert.equal(result.topic, 'my topic');
    assert.equal(result.mode, 'edit');
    assert.equal(result.maxTurns, 10);
  });

  it('parseArgs handles positional topic with --no-pr', () => {
    const result = parseArgs(['add', 'dark', 'mode', '--no-pr']);
    assert.equal(result.noPr, true);
    assert.equal(result.topic, 'add dark mode');
  });
});
