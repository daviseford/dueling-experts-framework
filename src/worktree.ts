import { execFile } from 'node:child_process';
import { join, resolve as resolvePath } from 'node:path';
import { access, rm } from 'node:fs/promises';

interface WorktreeResult {
  worktreePath: string;
  branchName: string;
  baseRef: string | null;
}

/**
 * Create a git worktree for a session's implement phase.
 * Branches from HEAD on a new branch `def/<short-id>-<slug>`.
 * Worktree lives at `<gitRoot>/.def/worktrees/<sessionId>`.
 */
export async function createWorktree(
  targetRepo: string,
  sessionId: string,
  topic: string,
  baseOverride?: string,
): Promise<WorktreeResult> {
  // Resolve the git toplevel (don't assume targetRepo is the root)
  const gitRoot = await git(targetRepo, ['rev-parse', '--show-toplevel']);

  const shortId = sessionId.slice(0, 8);
  const slug = slugifyTopic(topic) || 'session';
  const branchName = `def/${shortId}-${slug}`;
  const worktreePath = join(gitRoot, '.def', 'worktrees', sessionId);

  if (baseOverride) {
    // Fetch the specified branch and branch from it
    try {
      await git(gitRoot, ['fetch', 'origin', baseOverride]);
      await git(gitRoot, ['worktree', 'add', worktreePath, '-b', branchName, `origin/${baseOverride}`]);
      return { worktreePath, branchName, baseRef: baseOverride };
    } catch {
      // Fetch or worktree creation failed — fall through to default behavior
    }
  }

  // Default: capture the current branch as the PR base ref
  let baseRef: string | null = null;
  try {
    baseRef = await git(targetRepo, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    // Detached HEAD — leave null, gh will use repo default
  }

  await git(gitRoot, ['worktree', 'add', worktreePath, '-b', branchName]);

  return { worktreePath, branchName, baseRef };
}

/**
 * Remove a git worktree. Silently succeeds if already removed.
 * The branch is preserved — only the worktree directory is cleaned up.
 */
export async function removeWorktree(
  targetRepo: string,
  worktreePath: string,
): Promise<void> {
  try {
    await git(targetRepo, ['worktree', 'remove', worktreePath, '--force']);
  } catch {
    // Already removed or not a valid worktree — clean up directory if it's inside .def/worktrees/
    if (isDefWorktreePath(worktreePath)) {
      try {
        await rm(worktreePath, { recursive: true, force: true });
      } catch {
        // Best effort
      }
    }
  }
}

/**
 * Check if a worktree path at the given location actually exists on disk.
 */
export async function worktreeExists(worktreePath: string): Promise<boolean> {
  try {
    await access(worktreePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Slugify a topic string for use in branch names.
 * Lowercase, non-alphanumeric → hyphens, collapsed, trimmed to 30 chars.
 * Exported for testability.
 */
export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '');
}

// ── Diff capture ────────────────────────────────────────────────────

/**
 * Capture a unified diff of all changes in the worktree since the branch point.
 * Stages all changes first to include both committed and uncommitted modifications.
 * Returns empty string if no changes were made.
 */
export async function captureDiff(worktreePath: string): Promise<string> {
  // Stage everything so we capture all changes in one diff
  await git(worktreePath, ['add', '-A']);
  try {
    return await git(worktreePath, ['diff', '--cached', 'HEAD']);
  } catch {
    // HEAD may not exist or diff failed — return empty
    return '';
  }
}

/**
 * Commit all staged and unstaged changes in the worktree.
 * Call after captureDiff to persist changes on the branch before worktree removal.
 * No-ops if there is nothing to commit.
 */
export async function commitChanges(worktreePath: string, message: string): Promise<boolean> {
  await git(worktreePath, ['add', '-A']);
  try {
    const status = await git(worktreePath, ['status', '--porcelain']);
    if (!status) return false; // nothing to commit
    await git(worktreePath, ['commit', '-m', message]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current branch name in a worktree.
 * Returns null if HEAD is detached or the command fails.
 */
export async function currentBranch(worktreePath: string): Promise<string | null> {
  try {
    return await git(worktreePath, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    return null;
  }
}

/**
 * Rescue commits when an agent switched branches inside a worktree.
 *
 * The agent may have checked out a different branch (e.g. the target PR's
 * branch) and committed there instead of on the DEF branch. This function:
 * 1. Stashes any uncommitted work on the switched branch
 * 2. Checks out the DEF branch
 * 3. Cherry-picks commits from the switched branch that aren't on the DEF branch
 * 4. Pops any stashed work
 *
 * Best-effort: silently handles failures so the session can still finalize.
 */
export async function rescueBranchSwitch(
  worktreePath: string,
  defBranch: string,
  actualBranch: string,
): Promise<void> {
  try {
    // 1. Stash uncommitted changes on the switched branch
    let hasStash = false;
    try {
      const status = await git(worktreePath, ['status', '--porcelain']);
      if (status) {
        await git(worktreePath, ['stash', 'push', '-m', 'def-rescue']);
        hasStash = true;
      }
    } catch { /* no stash needed */ }

    // 2. Find commits unique to the switched branch (relative to DEF branch)
    let cherryCommits: string[] = [];
    try {
      const base = await git(worktreePath, ['merge-base', defBranch, actualBranch]);
      const log = await git(worktreePath, ['log', '--reverse', '--format=%H', `${base}..${actualBranch}`]);
      cherryCommits = log.split('\n').filter(Boolean);
    } catch { /* no commits to rescue */ }

    // 3. Switch back to the DEF branch
    await git(worktreePath, ['checkout', defBranch]);

    // 4. Cherry-pick commits from the switched branch
    for (const sha of cherryCommits) {
      try {
        await git(worktreePath, ['cherry-pick', sha]);
      } catch {
        // Conflict — abort this cherry-pick and skip
        try { await git(worktreePath, ['cherry-pick', '--abort']); } catch { /* */ }
      }
    }

    // 5. Pop stashed changes if any
    if (hasStash) {
      try { await git(worktreePath, ['stash', 'pop']); } catch { /* conflict — leave in stash */ }
    }
  } catch {
    // Last resort: just try to get back on the DEF branch
    try { await git(worktreePath, ['checkout', defBranch]); } catch { /* give up */ }
  }
}

// ── Internal helpers ────────────────────────────────────────────────

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, timeout: 30_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args[0]} failed: ${stderr.trim() || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * Validate that a resolved path is structurally inside a .def/worktrees/ directory.
 * Resolves the path to prevent traversal attacks, rejects ".." components.
 * Exported for use in recovery path validation.
 */
export function isDefWorktreePath(p: string): boolean {
  const resolved = resolvePath(p).replace(/\\/g, '/');
  const parts = resolved.split('/');
  const defIdx = parts.indexOf('.def');
  if (defIdx === -1) return false;
  if (parts[defIdx + 1] !== 'worktrees') return false;
  if (!parts[defIdx + 2]) return false;
  return !parts.includes('..');
}
