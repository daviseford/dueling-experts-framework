import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './util.js';

// ── Types ────────────────────────────────────────────────────────────

export interface PrResult {
  url: string;
  number: number;
}

export interface PrOptions {
  repoPath: string;       // worktree path (push from here)
  branchName: string;
  baseRef: string | null;  // null → let gh use repo default
  title: string;
  sessionDir: string;      // for reading decisions and writing body file
  topic: string;
  sessionId: string;
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Check whether the branch has commits beyond the base ref.
 * Returns true if there is a delta worth pushing.
 */
export async function hasBranchDelta(repoPath: string, baseRef: string | null): Promise<boolean> {
  if (!baseRef) {
    // No base ref (detached HEAD) — check if there are any commits at all
    // by comparing against an empty tree
    try {
      const log = await exec(repoPath, 'git', ['log', '--oneline', '-1']);
      return log.length > 0;
    } catch {
      return false;
    }
  }
  try {
    const log = await exec(repoPath, 'git', ['log', '--oneline', `${baseRef}..HEAD`]);
    return log.length > 0;
  } catch {
    return false;
  }
}

/**
 * Push the branch and create a draft PR on GitHub.
 * Best-effort: returns null on any failure (logged, never throws).
 */
export async function pushAndCreatePr(opts: PrOptions): Promise<PrResult | null> {
  const { repoPath, branchName, baseRef, title, sessionDir, topic, sessionId } = opts;

  // 1. Push branch to origin
  try {
    await exec(repoPath, 'git', ['push', '-u', 'origin', branchName]);
  } catch (err: unknown) {
    console.log(`Could not push branch: ${(err as Error).message}. Branch preserved: ${branchName}`);
    return null;
  }

  // 2. Build PR body and write to file
  const bodyPath = join(sessionDir, 'artifacts', 'pr-body.md');
  const body = await buildPrBody(sessionDir, topic, sessionId);
  await atomicWrite(bodyPath, body);

  // 3. Create draft PR
  try {
    const ghArgs = [
      'pr', 'create',
      '--draft',
      '--title', title,
      '--body-file', bodyPath,
      '--head', branchName,
    ];
    if (baseRef) {
      ghArgs.push('--base', baseRef);
    }

    const prUrl = await exec(repoPath, 'gh', ghArgs);
    const prNumber = parseInt(prUrl.split('/').pop()!, 10);

    if (!prUrl || isNaN(prNumber)) {
      console.log(`Could not parse PR URL from gh output: ${prUrl}`);
      return null;
    }

    return { url: prUrl, number: prNumber };
  } catch (err: unknown) {
    console.log(`Could not create draft PR: ${(err as Error).message}. Branch preserved: ${branchName}`);
    return null;
  }
}

// ── Internal helpers ────────────────────────────────────────────────

async function buildPrBody(sessionDir: string, topic: string, sessionId: string): Promise<string> {
  const lines: string[] = [];

  lines.push(`> Automated draft PR from DEF session \`${sessionId.slice(0, 8)}\``);
  lines.push('');
  lines.push(`**Topic:** ${topic}`);
  lines.push('');

  // Include decisions if available
  const decisionsPath = join(sessionDir, 'artifacts', 'decisions.md');
  try {
    const decisions = await readFile(decisionsPath, 'utf8');
    if (decisions.trim()) {
      lines.push('## Decisions');
      lines.push('');
      lines.push(decisions.trim());
      lines.push('');
    }
  } catch {
    // No decisions file — skip
  }

  return lines.join('\n') + '\n';
}

function exec(cwd: string, command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${command} ${args[0]} failed: ${stderr.trim() || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}
