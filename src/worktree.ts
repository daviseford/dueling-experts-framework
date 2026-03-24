import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';

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
  const slug = slugifyTopic(topic);
  const branchName = `def/${shortId}-${slug}`.slice(0, 50);
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
    const gitRoot = await git(targetRepo, ['rev-parse', '--show-toplevel']);
    await git(gitRoot, ['worktree', 'remove', worktreePath, '--force']);
  } catch {
    // Already removed or not a valid worktree — clean up the directory manually
    try {
      await rm(worktreePath, { recursive: true, force: true });
    } catch {
      // Best effort
    }
  }
}

/**
 * Slugify a topic string for use in branch names.
 * Lowercase, non-alphanumeric → hyphens, collapsed, trimmed to 30 chars.
 */
export function slugifyTopic(topic: string): string {
  return topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)
    .replace(/-$/, '');
}

// ── Internal helper ─────────────────────────────────────────────────

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
