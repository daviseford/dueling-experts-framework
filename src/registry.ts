import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { listSessions, findSessionDir } from './session.js';
import type { SessionSummaryInfo } from './session.js';

const DEF_HOME = join(homedir(), '.def');
const KNOWN_REPOS_FILE = join(DEF_HOME, 'known-repos');

/**
 * Register a repo path in the global known-repos file.
 * Appends `repoPath` if not already present. Creates the file and directory if needed.
 * Fire-and-forget safe — errors are swallowed.
 */
export async function registerRepo(repoPath: string): Promise<void> {
  await mkdir(DEF_HOME, { recursive: true });

  let existing = '';
  try {
    existing = await readFile(KNOWN_REPOS_FILE, 'utf8');
  } catch {
    // File doesn't exist yet
  }

  const paths = existing.split('\n').filter(Boolean);
  if (paths.includes(repoPath)) return;

  paths.push(repoPath);
  await writeFile(KNOWN_REPOS_FILE, paths.join('\n') + '\n', 'utf8');
}

/**
 * Read all known repo paths, filtering out stale entries
 * where `.def/sessions/` no longer exists.
 */
export async function listKnownRepos(): Promise<string[]> {
  let raw = '';
  try {
    raw = await readFile(KNOWN_REPOS_FILE, 'utf8');
  } catch {
    return [];
  }

  const paths = raw.split('\n').filter(Boolean);
  const valid: string[] = [];
  for (const p of paths) {
    try {
      await access(join(p, '.def', 'sessions'));
      valid.push(p);
    } catch {
      // Stale entry — skip
    }
  }
  return valid;
}

/**
 * Aggregate sessions from all known repos.
 * Each session is augmented with a `repo` field (the directory basename).
 * Sorted by `created` descending.
 */
export async function listAllSessions(): Promise<(SessionSummaryInfo & { repo: string })[]> {
  const repos = await listKnownRepos();
  const all: (SessionSummaryInfo & { repo: string })[] = [];

  for (const repoPath of repos) {
    const repoName = basename(repoPath);
    const sessions = await listSessions(repoPath);
    for (const s of sessions) {
      all.push({ ...s, repo: repoName });
    }
  }

  return all.sort((a, b) => b.created.localeCompare(a.created));
}

/**
 * Search all known repos for a session directory by UUID.
 * Returns the full session directory path, or null if not found.
 */
export async function findSessionDirGlobal(sessionId: string): Promise<string | null> {
  const repos = await listKnownRepos();
  for (const repoPath of repos) {
    const dir = await findSessionDir(repoPath, sessionId, { exact: true });
    if (dir) return dir;
  }
  return null;
}
