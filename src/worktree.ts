import { execFile } from 'node:child_process';
import { join, resolve as resolvePath } from 'node:path';
import { access, rm } from 'node:fs/promises';

interface WorktreeResult {
  worktreePath: string;
  branchName: string;
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
): Promise<WorktreeResult> {
  // Resolve the git toplevel (don't assume targetRepo is the root)
  const gitRoot = await git(targetRepo, ['rev-parse', '--show-toplevel']);
  const shortId = sessionId.slice(0, 8);
  const slug = slugifyTopic(topic) || 'session';
  const branchName = `def/${shortId}-${slug}`;
  const worktreePath = join(gitRoot, '.def', 'worktrees', sessionId);

  await git(gitRoot, ['worktree', 'add', worktreePath, '-b', branchName]);

  return { worktreePath, branchName };
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
