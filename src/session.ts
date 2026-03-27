import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { atomicWrite, killChildProcess, isProcessAlive } from './util.js';
import { removeWorktree, commitChanges } from './worktree.js';
import * as ui from './ui.js';
import type { Participant } from './roster.js';
import { buildDefaultRoster, buildRoster } from './roster.js';

// ── Type definitions ────────────────────────────────────────────────

/** Agent name -- widened from 'claude' | 'codex' to string for pluggable backends. */
export type AgentName = string;
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
  next_agent: string;
  phase: SessionPhase;
  impl_model: string;
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
  heartbeat_at?: string;
  /** Ordered list of participants in this session. */
  roster: Participant[];
  /** Optional budget cap in USD. */
  budget?: number;
  _currentChild?: ChildProcess | null;
}

export interface CreateSessionOptions {
  topic: string;
  mode: string;
  maxTurns: number;
  firstAgent: string;
  implModel: string;
  reviewTurns: number;
  targetRepo: string;
  /** Explicit agent list (e.g., ['claude', 'claude'] for self-debate). */
  agents?: string[];
  /** Budget cap in USD. */
  budget?: number;
  /** Display names for providers (from registry). */
  displayNames?: Record<string, string>;
}

// ── Session CRUD ────────────────────────────────────────────────────

/**
 * Create a new session directory and session.json.
 * Each session is independent — multiple sessions can run concurrently.
 */
export async function create({ topic, mode, maxTurns, firstAgent, implModel, reviewTurns, targetRepo, agents, budget, displayNames }: CreateSessionOptions): Promise<Session> {
  const defDir = join(targetRepo, '.def');

  // Ensure .def/ exists
  await mkdir(defDir, { recursive: true });

  // Create session directory
  const id = randomUUID();
  const sessionDir = join(defDir, 'sessions', id);
  await mkdir(join(sessionDir, 'turns'), { recursive: true });
  await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
  await mkdir(join(sessionDir, 'runtime'), { recursive: true });

  // Build roster from explicit --agents list or default pair
  const roster = agents
    ? buildRoster(agents, implModel, displayNames)
    : buildDefaultRoster(firstAgent, implModel, displayNames);

  // For self-debate rosters, use the generated participant IDs
  const effectiveFirstAgent = roster[0].id;
  const effectiveImplModel = roster.find(p => p.role === 'implementer')?.id ?? roster[0].id;

  const session: Omit<Session, 'dir'> = {
    id,
    topic,
    mode,
    max_turns: maxTurns,
    target_repo: targetRepo,
    created: new Date().toISOString(),
    session_status: 'active',
    current_turn: 0,
    next_agent: effectiveFirstAgent,
    phase: 'plan',
    impl_model: effectiveImplModel,
    review_turns: reviewTurns || 6,
    port: null,
    pid: process.pid,
    worktree_path: null,
    branch_name: null,
    original_repo: null,
    base_ref: null,
    pr_url: null,
    pr_number: null,
    roster,
    budget: budget ?? undefined,
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
  // Synthesize roster for sessions created before the roster feature
  if (!parsed.roster) {
    parsed.roster = buildDefaultRoster(
      parsed.next_agent || 'claude',
      parsed.impl_model || 'claude',
    );
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

    // Hard timeout — force exit if async cleanup hangs (e.g., git operations,
    // file I/O, or the orchestrator is blocked on waitForHuman)
    const forceTimer = setTimeout(() => process.exit(1), 5000);
    forceTimer.unref(); // Don't keep event loop alive

    try {
      ui.status('shutdown.start', {});

      // Mark session as completed FIRST — before any slow operations.
      // If the force timer fires or cleanup hangs, the session status
      // is already updated so it won't appear stuck as paused/active.
      await update(sessionDir, { session_status: 'completed' });

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

      // Tell the user where their work lives so they can recover
      if (session?.branch_name) {
        ui.status('shutdown.recovery', { branch: session.branch_name });
      }
    } catch { /* best effort */ }
    process.exit(0);
  });
}

/**
 * List canonical turn files in a session's turns directory, sorted by turn number.
 */
export async function listTurnFiles(turnsDir: string): Promise<string[]> {
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

// ── Session finder ─────────────────────────────────────────────────

export interface SessionSummaryInfo {
  id: string;
  topic: string;
  created: string;
  session_status: string;
  phase: string;
  current_turn: number;
  mode: string;
  branch_name: string | null;
  pr_url: string | null;
  dir: string;
  port?: number | null;
  pid?: number;
  heartbeat_at?: string;
  is_active: boolean;
}

export async function findSessionDir(targetRepo: string, id: string, opts?: { exact?: boolean }): Promise<string | null> {
  const sessionsDir = join(targetRepo, '.def', 'sessions');
  let dirs: string[];
  try {
    dirs = await readdir(sessionsDir);
  } catch {
    return null;
  }
  const matches = opts?.exact
    ? dirs.filter(d => d === id)
    : dirs.filter(d => d.startsWith(id));
  if (matches.length === 1) return join(sessionsDir, matches[0]);
  return null;
}

/** Heartbeat staleness threshold (30 seconds). */
const HEARTBEAT_STALE_MS = 30_000;

/**
 * Check whether a session is still alive based on its PID and heartbeat freshness.
 * Returns `{ alive: true, status: 'active' }` when the process is running with a
 * fresh heartbeat (or no heartbeat file yet), or `{ alive: false, status }` otherwise.
 */
export async function isSessionAlive(sessionDir: string): Promise<{ alive: boolean; status: string; heartbeatAt?: string }> {
  const sessionPath = join(sessionDir, 'session.json');
  const raw = await readFile(sessionPath, 'utf8');
  const data = JSON.parse(raw);

  const sessionStatus: string = data.session_status ?? 'unknown';
  const pid: number | undefined = data.pid;

  // Only active and paused sessions can be "alive" — check PID + heartbeat for both.
  // A paused session still has a running orchestrator process with a heartbeat writer.
  if ((sessionStatus !== 'active' && sessionStatus !== 'paused') || !pid) {
    return { alive: false, status: sessionStatus };
  }

  // Read heartbeat.json (separate file to avoid session.json contention)
  let heartbeatAt: string | undefined;
  try {
    const hbRaw = await readFile(join(sessionDir, 'heartbeat.json'), 'utf8');
    const hb = JSON.parse(hbRaw);
    heartbeatAt = hb.heartbeat_at;
  } catch {
    // No heartbeat file (pre-existing session or not yet written)
  }

  const pidAlive = isProcessAlive(pid);
  const heartbeatFresh = heartbeatAt
    ? (Date.now() - new Date(heartbeatAt).getTime()) < HEARTBEAT_STALE_MS
    : false;

  if (pidAlive && (heartbeatFresh || !heartbeatAt)) {
    return { alive: true, status: sessionStatus, heartbeatAt };
  }

  // PID dead or heartbeat stale — detected crash
  return { alive: false, status: 'interrupted', heartbeatAt };
}

export async function listSessions(targetRepo: string): Promise<SessionSummaryInfo[]> {
  const sessionsDir = join(targetRepo, '.def', 'sessions');
  let dirs: string[];
  try {
    dirs = await readdir(sessionsDir);
  } catch {
    return [];
  }

  const summaries: SessionSummaryInfo[] = [];
  for (const dir of dirs) {
    try {
      const sessionDir = join(sessionsDir, dir);
      const sessionPath = join(sessionDir, 'session.json');
      const raw = await readFile(sessionPath, 'utf8');
      const data = JSON.parse(raw);

      const { alive, status: resolvedStatus, heartbeatAt } = await isSessionAlive(sessionDir);

      summaries.push({
        id: data.id ?? dir,
        topic: data.topic ?? '(no topic)',
        created: data.created ?? '',
        session_status: resolvedStatus,
        phase: data.phase === 'debate' ? 'plan' : (data.phase ?? 'plan'),
        current_turn: data.current_turn ?? 0,
        mode: data.mode ?? 'edit',
        branch_name: data.branch_name ?? null,
        pr_url: data.pr_url ?? null,
        dir: sessionDir,
        port: data.port ?? null,
        pid: data.pid,
        heartbeat_at: heartbeatAt,
        is_active: alive,
      });
    } catch {
      // Skip corrupted session directories
    }
  }

  return summaries.sort((a, b) => b.created.localeCompare(a.created));
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
