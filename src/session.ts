import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { atomicWrite, killChildProcess } from './util.js';
import { removeWorktree, commitChanges } from './worktree.js';
import * as ui from './ui.js';

// ── Token usage types ──────────────────────────────────────────────

export type ModelTier = 'full' | 'mid' | 'fast';

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export interface TurnTokenEntry {
  turn: number;
  agent: string;
  model_tier: ModelTier;
  model_name: string;
  tokens: TokenUsage;
}

export interface CumulativeUsage {
  total_input_tokens: number;
  total_output_tokens: number;
  total_cache_creation_tokens: number;
  total_cache_read_tokens: number;
  per_turn: TurnTokenEntry[];
}

// ── Type definitions ────────────────────────────────────────────────

export type AgentName = 'claude' | 'codex';
export type SessionStatus = 'active' | 'paused' | 'completed' | 'interrupted';
export type SessionPhase = 'plan' | 'implement' | 'review';

export interface Session {
  id: string;
  topic: string;
  mode: string;
  max_turns: number;
  target_repo: string;
  created: string;
  session_status: SessionStatus;
  current_turn: number;
  next_agent: AgentName;
  phase: SessionPhase;
  impl_model: AgentName;
  review_turns: number;
  port: number | null;
  pid: number;
  dir: string;
  worktree_path: string | null;
  branch_name: string | null;
  original_repo: string | null;
  base_ref: string | null;
  pr_url: string | null;
  pr_number: number | null;
  usage?: CumulativeUsage | null;
  _currentChild?: ChildProcess | null;
}

export interface CreateSessionOptions {
  topic: string;
  mode: string;
  maxTurns: number;
  firstAgent: AgentName;
  implModel: AgentName;
  reviewTurns: number;
  targetRepo: string;
}

// ── Session CRUD ────────────────────────────────────────────────────

/**
 * Create a new session directory and session.json.
 * Each session is independent — multiple sessions can run concurrently.
 */
export async function create({ topic, mode, maxTurns, firstAgent, implModel, reviewTurns, targetRepo }: CreateSessionOptions): Promise<Session> {
  const defDir = join(targetRepo, '.def');

  // Ensure .def/ exists
  await mkdir(defDir, { recursive: true });

  // Create session directory
  const id = randomUUID();
  const sessionDir = join(defDir, 'sessions', id);
  await mkdir(join(sessionDir, 'turns'), { recursive: true });
  await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
  await mkdir(join(sessionDir, 'runtime'), { recursive: true });

  const session: Omit<Session, 'dir'> = {
    id,
    topic,
    mode,
    max_turns: maxTurns,
    target_repo: targetRepo,
    created: new Date().toISOString(),
    session_status: 'active',
    current_turn: 0,
    next_agent: firstAgent,
    phase: 'plan',
    impl_model: implModel || 'claude',
    review_turns: reviewTurns || 6,
    port: null,
    pid: process.pid,
    worktree_path: null,
    branch_name: null,
    original_repo: null,
    base_ref: null,
    pr_url: null,
    pr_number: null,
    usage: null,
  };

  await atomicWriteJson(join(sessionDir, 'session.json'), session);

  // Add .def/ to .gitignore if not already present
  await ensureGitignore(targetRepo);

  return { ...session, dir: sessionDir };
}

/**
 * Load an existing session from its directory.
 */
export async function load(sessionDir: string): Promise<Session> {
  const raw = await readFile(join(sessionDir, 'session.json'), 'utf8');
  const parsed = JSON.parse(raw);
  // Normalize legacy 'debate' phase to 'plan'
  if (parsed.phase === 'debate') {
    parsed.phase = 'plan';
  }
  return { ...parsed, dir: sessionDir } as Session;
}

/**
 * Atomically update session.json (write temp → rename).
 */
export async function update(sessionDir: string, fields: Partial<Session>): Promise<Session> {
  const sessionPath = join(sessionDir, 'session.json');
  const raw = await readFile(sessionPath, 'utf8');
  const session: Session = { ...JSON.parse(raw), ...fields };
  await atomicWriteJson(sessionPath, session);
  return session;
}

/**
 * Write JSON atomically with fsync via shared utility.
 */
async function atomicWriteJson(filePath: string, data: object): Promise<void> {
  await atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Install a SIGINT handler for clean shutdown.
 * Sets session to 'interrupted' (recoverable) and kills child processes.
 */
export function installShutdownHandler(sessionDir: string, targetRepo: string, session: Session | null = null): void {
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) process.exit(1); // Double Ctrl+C — hard exit
    shuttingDown = true;
    ui.status('shutdown.start', {});
    try {
      // Kill the running agent child process
      const child = session?._currentChild;
      if (child && !child.killed) {
        killChildProcess(child);
      }

      // Commit any uncommitted changes before worktree removal
      if (session?.worktree_path) {
        try {
          await commitChanges(session.worktree_path, 'def: interrupted changes');
          ui.status('shutdown.saved', {});
        } catch { /* best effort */ }
      }

      // Clean up worktree (branch is preserved)
      if (session?.worktree_path && session?.original_repo) {
        try {
          await removeWorktree(session.original_repo, session.worktree_path);
          ui.status('shutdown.worktree', { branch: session.branch_name! });
        } catch { /* best effort */ }
      }

      await update(sessionDir, { session_status: 'completed' });
    } catch { /* best effort */ }
    process.exit(0);
  });
}

/**
 * List canonical turn files in a session's turns directory, sorted by turn number.
 */
export async function listTurnFiles(turnsDir: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  let files: string[] = [];
  try {
    files = await readdir(turnsDir);
  } catch {
    return [];
  }
  return files
    .filter((f: string) => f.startsWith('turn-') && f.endsWith('.md') && !f.endsWith('.tmp'))
    .sort();
}

async function ensureGitignore(targetRepo: string): Promise<void> {
  const gitignorePath = join(targetRepo, '.gitignore');
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch {
    // No .gitignore — we'll create one
  }
  if (!content.includes('.def/') && !content.includes('.def\n')) {
    const line = content.endsWith('\n') || content === '' ? '.def/\n' : '\n.def/\n';
    await writeFile(gitignorePath, content + line, 'utf8');
  }
}
