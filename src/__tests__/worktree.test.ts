import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { slugifyTopic, createWorktree, removeWorktree } from '../worktree.js';

describe('slugifyTopic', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    assert.equal(slugifyTopic('Add Dark Mode'), 'add-dark-mode');
  });

  it('removes non-alphanumeric characters', () => {
    assert.equal(slugifyTopic('feat: add API!'), 'feat-add-api');
  });

  it('collapses consecutive hyphens', () => {
    assert.equal(slugifyTopic('one   two---three'), 'one-two-three');
  });

  it('trims leading and trailing hyphens', () => {
    assert.equal(slugifyTopic('--hello--'), 'hello');
  });

  it('truncates to 30 characters without trailing hyphen', () => {
    const long = 'a'.repeat(40);
    const result = slugifyTopic(long);
    assert.ok(result.length <= 30);
    assert.ok(!result.endsWith('-'));
  });

  it('truncates long topics and strips trailing hyphen after truncation', () => {
    const result = slugifyTopic('implement the worktree isolation feature');
    assert.ok(result.length <= 30);
    assert.ok(!result.endsWith('-'));
  });

  it('handles empty string', () => {
    assert.equal(slugifyTopic(''), '');
  });
});

describe('createWorktree / removeWorktree', () => {
  let testDir: string;

  before(async () => {
    testDir = join(tmpdir(), `def-wt-test-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
    // Initialize a git repo with an initial commit
    execFileSync('git', ['init'], { cwd: testDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: testDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: testDir });
    // Need at least one commit for worktree to branch from
    const readmePath = join(testDir, 'README.md');
    await writeFile(readmePath, '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: testDir });
  });

  after(async () => {
    // Clean up any worktrees first, then remove dir
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: testDir });
    } catch { /* ignore */ }
    await rm(testDir, { recursive: true, force: true });
  });

  it('creates a worktree and branch', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'test topic');

    // Branch name format: def/<8-char-id>-<slug>
    assert.ok(branchName.startsWith('def/'));
    assert.ok(branchName.includes('test-topic'));

    // Worktree path exists and is a git checkout
    const readme = await readFile(join(worktreePath, 'README.md'), 'utf8');
    assert.ok(readme.startsWith('# Test'), 'worktree should contain checked-out files');

    // git worktree list should show the new worktree
    const output = execFileSync('git', ['worktree', 'list'], { cwd: testDir, encoding: 'utf8' });
    assert.ok(output.includes(sessionId), 'worktree list should contain session id');

    // Clean up
    await removeWorktree(testDir, worktreePath);
  });

  it('removeWorktree cleans up the worktree but preserves the branch', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'cleanup test');

    await removeWorktree(testDir, worktreePath);

    // Worktree should be gone
    const output = execFileSync('git', ['worktree', 'list'], { cwd: testDir, encoding: 'utf8' });
    assert.ok(!output.includes(sessionId), 'worktree should be removed');

    // Branch should still exist
    const branches = execFileSync('git', ['branch'], { cwd: testDir, encoding: 'utf8' });
    assert.ok(branches.includes(branchName.replace('def/', '')), 'branch should persist');
  });

  it('removeWorktree succeeds silently if already removed', async () => {
    // Should not throw
    await removeWorktree(testDir, join(testDir, '.def', 'worktrees', 'nonexistent'));
  });

  it('createWorktree fails with clear error outside a git repo', async () => {
    const nonGit = join(tmpdir(), `def-nogit-${randomUUID()}`);
    await mkdir(nonGit, { recursive: true });
    try {
      await assert.rejects(
        () => createWorktree(nonGit, randomUUID(), 'test'),
        /git rev-parse failed/,
      );
    } finally {
      await rm(nonGit, { recursive: true, force: true });
    }
  });
});
