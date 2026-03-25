import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './util.js';
import * as ui from './ui.js';

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

// ── PR URL parsing ──────────────────────────────────────────────────

export interface PrRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Extract a GitHub PR reference (owner, repo, number) from a topic string.
 * Returns null if the topic doesn't contain a valid PR URL.
 */
export function parsePrRef(topic: string): PrRef | null {
  const match = topic.match(/https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const num = parseInt(match[3], 10);
  if (num <= 0 || !isFinite(num)) return null;
  return { owner: match[1], repo: match[2], number: num };
}

/**
 * Look up a PR's head branch name using `gh pr view`.
 * Returns the branch name on success, null on any failure.
 * Best-effort: never throws.
 */
export async function lookupPrHeadBranch(ref: PrRef): Promise<string | null> {
  try {
    const branch = await exec('.', 'gh', [
      'pr', 'view', String(ref.number),
      '--repo', `${ref.owner}/${ref.repo}`,
      '--json', 'headRefName',
      '--jq', '.headRefName',
    ]);
    return branch || null;
  } catch {
    ui.status('pr.lookup.failed', {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
    });
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────

/**
 * Check whether the branch has commits beyond the base ref.
 * Returns true if there is a delta worth pushing.
 * Conservatively returns false when no reliable base can be established.
 *
 * If `baseRef` cannot be resolved (e.g. deleted branch), falls back to
 * `origin/main`, then `origin/master`, then `main`, then `master`.
 * The resolved fallback is returned via `resolvedRef` when provided.
 */
export async function hasBranchDelta(
  repoPath: string,
  baseRef: string | null,
  out?: { resolvedRef?: string },
): Promise<boolean> {
  const candidates = baseRef
    ? [baseRef, 'origin/main', 'origin/master', 'main', 'master']
    : [];

  if (!baseRef) {
    // No base ref (detached HEAD or unavailable) — we cannot reliably
    // determine if there's a delta. Skip PR creation rather than guessing.
    return false;
  }

  for (const ref of candidates) {
    try {
      // Verify the ref actually resolves before using it
      await exec(repoPath, 'git', ['rev-parse', '--verify', ref]);
      const log = await exec(repoPath, 'git', ['log', '--oneline', `${ref}..HEAD`]);
      if (out) out.resolvedRef = ref;
      if (ref !== baseRef) {
        ui.status('base.fallback', { original: baseRef, resolved: ref });
      }
      return log.length > 0;
    } catch {
      // This ref didn't resolve — try next candidate
      continue;
    }
  }

  // None of the candidates resolved
  ui.status('base.unresolvable', { original: baseRef });
  return false;
}

/**
 * Push the branch and create a PR on GitHub.
 * Best-effort: returns null on any failure (logged, never throws).
 */
export async function pushAndCreatePr(opts: PrOptions): Promise<PrResult | null> {
  const { repoPath, branchName, baseRef, title, sessionDir, topic, sessionId } = opts;

  // 1. Push branch to origin
  try {
    await exec(repoPath, 'git', ['push', '-u', 'origin', branchName]);
  } catch (err: unknown) {
    ui.status('push.failed', { branch: branchName, error: (err as Error).message });
    return null;
  }

  // 2. Build PR body and write to file
  const bodyPath = join(sessionDir, 'artifacts', 'pr-body.md');
  const body = await buildPrBody(sessionDir, topic, sessionId, repoPath, baseRef);
  await atomicWrite(bodyPath, body);

  // 3. Create PR
  try {
    const ghArgs = [
      'pr', 'create',
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
      ui.status('pr.parse.failed', { output: prUrl });
      return null;
    }

    return { url: prUrl, number: prNumber };
  } catch (err: unknown) {
    ui.status('pr.failed', { branch: branchName, error: (err as Error).message });
    return null;
  }
}

// ── Internal helpers ────────────────────────────────────────────────

/**
 * Extract clean decision bullets from decisions.md.
 * The file format uses numbered lines like: `1. **[claude]** decision text`
 * We extract just the decision text. Lines that don't match are kept as-is.
 */
export function parseDecisionBullets(raw: string): string[] {
  const lines = raw.split('\n').filter(l => l.trim());
  const bullets: string[] = [];
  const agentPrefix = /^\d+\.\s+\*\*\[.*?\]\*\*\s*/;

  for (const line of lines) {
    const match = line.match(agentPrefix);
    if (match) {
      bullets.push(line.slice(match[0].length).trim());
    } else if (line.match(/^\d+\.\s+/)) {
      // Numbered line without agent prefix
      bullets.push(line.replace(/^\d+\.\s+/, '').trim());
    } else if (line.startsWith('- ')) {
      bullets.push(line.slice(2).trim());
    }
    // Skip header lines, blank lines, etc.
  }

  return bullets;
}

/**
 * Extract the summary line from git diff --stat output.
 * The last non-empty line is always something like:
 * "12 files changed, 450 insertions(+), 32 deletions(-)"
 */
export function parseDiffstatSummary(diffstat: string): string {
  const lines = diffstat.split('\n').filter(l => l.trim());
  if (lines.length === 0) return '';
  const last = lines[lines.length - 1].trim();
  // Verify it looks like a diffstat summary
  if (last.includes('changed')) return last;
  return '';
}

export async function buildPrBody(sessionDir: string, topic: string, sessionId: string, repoPath: string, baseRef: string | null): Promise<string> {
  const lines: string[] = [];

  lines.push(`> Automated PR from DEF session \`${sessionId.slice(0, 8)}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`**Topic:** ${topic}`);
  lines.push('');

  // Gather git stats for the summary paragraph
  let diffstat = '';
  let commitLog = '';
  let diffSummaryLine = '';
  let commitCount = 0;

  if (baseRef) {
    try {
      diffstat = await exec(repoPath, 'git', ['diff', '--stat', `${baseRef}..HEAD`]);
      commitLog = await exec(repoPath, 'git', ['log', '--oneline', `${baseRef}..HEAD`]);
      diffSummaryLine = parseDiffstatSummary(diffstat);
      commitCount = commitLog.split('\n').filter(l => l.trim()).length;
    } catch {
      // diff/log failed — continue without stats
    }
  }

  // Build a short narrative summary line
  if (diffSummaryLine && commitCount > 0) {
    lines.push(`${diffSummaryLine} across ${commitCount} commit${commitCount === 1 ? '' : 's'}.`);
    lines.push('');
  }

  // Key decisions as clean bullets
  const decisionsPath = join(sessionDir, 'artifacts', 'decisions.md');
  let rawDecisions = '';
  try {
    rawDecisions = await readFile(decisionsPath, 'utf8');
  } catch {
    // No decisions file
  }

  const bullets = rawDecisions ? parseDecisionBullets(rawDecisions) : [];

  if (bullets.length > 0) {
    lines.push('## Key Decisions');
    lines.push('');
    for (const bullet of bullets) {
      lines.push(`- ${bullet}`);
    }
    lines.push('');
  }

  // Full decisions log for traceability (always preserved when raw content exists)
  if (rawDecisions.trim()) {
    lines.push('<details>');
    lines.push('<summary>Full decisions log</summary>');
    lines.push('');
    lines.push(rawDecisions.trim());
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }

  // Collapsible commits and diffstat
  if (commitLog || diffstat) {
    const summaryLabel = [
      commitCount > 0 ? `${commitCount} commit${commitCount === 1 ? '' : 's'}` : null,
      diffSummaryLine || null,
    ].filter(Boolean).join(', ');

    lines.push('<details>');
    lines.push(`<summary>${summaryLabel || 'Changes'}</summary>`);
    lines.push('');
    if (commitLog) {
      lines.push('**Commits:**');
      lines.push('```');
      lines.push(commitLog);
      lines.push('```');
      lines.push('');
    }
    if (diffstat) {
      lines.push('**Diffstat:**');
      lines.push('```');
      lines.push(diffstat);
      lines.push('```');
      lines.push('');
    }
    lines.push('</details>');
    lines.push('');
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
