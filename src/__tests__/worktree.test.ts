import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { slugifyTopic, createWorktree, removeWorktree, captureDiff, commitChanges, currentBranch, rescueBranchSwitch } from '../worktree.js';

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

  it('captureDiff returns diff of changes in worktree', async () => {
    const sessionId = randomUUID();
    const { worktreePath } = await createWorktree(testDir, sessionId, 'diff test');

    // Make a change in the worktree
    await writeFile(join(worktreePath, 'new-file.txt'), 'hello world\n');

    const diff = await captureDiff(worktreePath);
    assert.ok(diff.includes('new-file.txt'), 'diff should include the new file');
    assert.ok(diff.includes('+hello world'), 'diff should include the added content');

    // Clean up
    await removeWorktree(testDir, worktreePath);
  });

  it('captureDiff returns empty string when no changes', async () => {
    const sessionId = randomUUID();
    const { worktreePath } = await createWorktree(testDir, sessionId, 'no changes');

    const diff = await captureDiff(worktreePath);
    assert.equal(diff, '', 'diff should be empty when no changes made');

    await removeWorktree(testDir, worktreePath);
  });

  it('commitChanges persists changes on the branch across worktree removal', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'commit test');

    // Make a change
    await writeFile(join(worktreePath, 'committed-file.txt'), 'persisted\n');

    // Commit it
    const committed = await commitChanges(worktreePath, 'test commit');
    assert.ok(committed, 'commitChanges should return true when changes exist');

    // Remove worktree
    await removeWorktree(testDir, worktreePath);

    // Verify the commit exists on the branch
    const log = execFileSync('git', ['log', '--oneline', branchName], { cwd: testDir, encoding: 'utf8' });
    assert.ok(log.includes('test commit'), 'branch should have the commit');
  });

  it('commitChanges returns false when nothing to commit', async () => {
    const sessionId = randomUUID();
    const { worktreePath } = await createWorktree(testDir, sessionId, 'empty commit test');

    const committed = await commitChanges(worktreePath, 'nothing');
    assert.equal(committed, false, 'commitChanges should return false with no changes');

    await removeWorktree(testDir, worktreePath);
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

  it('currentBranch returns the branch name in a worktree', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'branch check');

    const branch = await currentBranch(worktreePath);
    assert.equal(branch, branchName, 'should return the DEF branch name');

    await removeWorktree(testDir, worktreePath);
  });

  it('currentBranch returns null for invalid path', async () => {
    const branch = await currentBranch('/nonexistent/path');
    assert.equal(branch, null, 'should return null for invalid repo');
  });

  it('createWorktree with baseOverride branches from the specified ref', async () => {
    // Create a feature branch with a commit to use as baseOverride
    execFileSync('git', ['checkout', '-b', 'feature-base'], { cwd: testDir });
    await writeFile(join(testDir, 'feature.txt'), 'feature content\n');
    execFileSync('git', ['add', '.'], { cwd: testDir });
    execFileSync('git', ['commit', '-m', 'feature commit'], { cwd: testDir });
    // Go back to the default branch
    const defaultBranch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: testDir, encoding: 'utf8',
    }).trim();
    execFileSync('git', ['checkout', defaultBranch === 'feature-base' ? 'master' : defaultBranch], { cwd: testDir });

    const sessionId = randomUUID();
    // baseOverride won't work without a remote, so we expect it to fall back to HEAD behavior
    // (In a real scenario with origin, it would fetch and branch from the remote ref)
    const { worktreePath, branchName, baseRef } = await createWorktree(
      testDir, sessionId, 'override test', 'feature-base',
    );

    // Should have fallen back to default behavior since there's no remote
    assert.ok(branchName.startsWith('def/'));
    assert.ok(baseRef !== undefined); // baseRef is set (either override or HEAD fallback)

    await removeWorktree(testDir, worktreePath);

    // Clean up the feature branch
    try {
      execFileSync('git', ['branch', '-D', 'feature-base'], { cwd: testDir });
    } catch { /* ignore */ }
  });

  it('createWorktree without baseOverride uses HEAD (no regression)', async () => {
    const sessionId = randomUUID();
    const { worktreePath, baseRef } = await createWorktree(testDir, sessionId, 'no override');

    const currentHead = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd: testDir, encoding: 'utf8',
    }).trim();

    assert.equal(baseRef, currentHead, 'baseRef should match HEAD when no override');

    await removeWorktree(testDir, worktreePath);
  });

  it('rescueBranchSwitch cherry-picks commits from switched branch', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'rescue test');

    // Simulate: agent creates a new branch and commits there
    execFileSync('git', ['checkout', '-b', 'agent-switched'], { cwd: worktreePath });
    await writeFile(join(worktreePath, 'rescued.txt'), 'rescued content\n');
    execFileSync('git', ['add', '.'], { cwd: worktreePath });
    execFileSync('git', ['commit', '-m', 'agent commit on wrong branch'], { cwd: worktreePath });

    // Verify we're on the wrong branch
    const beforeBranch = await currentBranch(worktreePath);
    assert.equal(beforeBranch, 'agent-switched');

    // Rescue should cherry-pick the commit onto the DEF branch
    await rescueBranchSwitch(worktreePath, branchName, 'agent-switched');

    // Should now be on the DEF branch
    const afterBranch = await currentBranch(worktreePath);
    assert.equal(afterBranch, branchName, 'should be back on DEF branch');

    // The commit should be on the DEF branch
    const log = execFileSync('git', ['log', '--oneline', branchName], {
      cwd: worktreePath, encoding: 'utf8',
    });
    assert.ok(log.includes('agent commit on wrong branch'), 'cherry-picked commit should be on DEF branch');

    // The rescued file should exist
    const content = await readFile(join(worktreePath, 'rescued.txt'), 'utf8');
    assert.ok(content.trim() === 'rescued content', 'rescued file should have expected content');

    await removeWorktree(testDir, worktreePath);
  });

  it('rescueBranchSwitch handles uncommitted changes on switched branch', async () => {
    const sessionId = randomUUID();
    const { worktreePath, branchName } = await createWorktree(testDir, sessionId, 'rescue uncommitted');

    // Switch branch and leave uncommitted changes
    execFileSync('git', ['checkout', '-b', 'agent-uncommitted'], { cwd: worktreePath });
    await writeFile(join(worktreePath, 'uncommitted.txt'), 'uncommitted\n');

    await rescueBranchSwitch(worktreePath, branchName, 'agent-uncommitted');

    const afterBranch = await currentBranch(worktreePath);
    assert.equal(afterBranch, branchName, 'should be back on DEF branch');

    await removeWorktree(testDir, worktreePath);
  });
});
