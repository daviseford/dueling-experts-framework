import { readdir, readFile, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './orchestrator.js';
import { load, installShutdownHandler, update } from './session.js';
import type { Session } from './session.js';
import { isProcessAlive } from './util.js';
import { worktreeExists, isDefWorktreePath } from './worktree.js';

interface RecoverableSession {
  id: string;
  dir: string;
  topic: string;
  current_turn: number;
  session_status: string;
}

/**
 * Check for recoverable sessions on startup.
 * Scans all sessions and uses the PID in session.json to detect stale ones.
 * Returns true if a session was auto-resumed, false otherwise.
 */
export async function checkForRecovery(targetRepo: string): Promise<boolean | { multiple: true; sessions: RecoverableSession[] }> {
  const sessionsDir = join(targetRepo, '.def', 'sessions');

  let sessionDirs;
  try {
    sessionDirs = await readdir(sessionsDir);
  } catch {
    return false; // No sessions directory
  }

  const recoverable: RecoverableSession[] = [];

  for (const dirName of sessionDirs) {
    const sessionDir = join(sessionsDir, dirName);
    const sessionPath = join(sessionDir, 'session.json');

    try {
      const raw = await readFile(sessionPath, 'utf8');
      const data = JSON.parse(raw);

      if (data.session_status === 'active' || data.session_status === 'paused' || data.session_status === 'interrupted') {
        // If the owning process is still alive, skip — it's a running session
        if (data.pid && isProcessAlive(data.pid)) {
          continue;
        }
        // Stale active session — mark as interrupted so it's recoverable
        if (data.session_status === 'active') {
          await update(sessionDir, { session_status: 'interrupted' });
          data.session_status = 'interrupted';
        }
        recoverable.push({
          id: data.id,
          dir: sessionDir,
          topic: data.topic,
          current_turn: data.current_turn,
          session_status: data.session_status,
        });
      }
    } catch {
      // Corrupt or missing session.json — skip
    }
  }

  if (recoverable.length === 0) {
    return false;
  }

  if (recoverable.length === 1) {
    const session = recoverable[0];
    console.log(`Resuming session ${session.id} from turn ${session.current_turn + 1}`);
    console.log(`Topic: ${session.topic}`);
    await doResume(targetRepo, session.dir);
    return true;
  }

  // Multiple recoverable sessions — return list for caller to handle
  return { multiple: true, sessions: recoverable };
}

/**
 * Resume a specific session by ID.
 */
export async function resumeSession(targetRepo: string, sessionId: string): Promise<void> {
  const sessionsDir = join(targetRepo, '.def', 'sessions');

  let sessionDirs;
  try {
    sessionDirs = await readdir(sessionsDir);
  } catch {
    console.error('No sessions found.');
    process.exit(1);
  }

  for (const dirName of sessionDirs) {
    const sessionDir = join(sessionsDir, dirName);
    const sessionPath = join(sessionDir, 'session.json');

    try {
      const raw = await readFile(sessionPath, 'utf8');
      const data = JSON.parse(raw);

      if (data.id === sessionId) {
        if (data.session_status === 'completed') {
          console.error(`Session ${sessionId} is already completed.`);
          process.exit(1);
        }
        console.log(`Resuming session ${sessionId} from turn ${data.current_turn + 1}`);
        await doResume(targetRepo, sessionDir);
        return;
      }
    } catch {
      // Skip corrupt sessions
    }
  }

  console.error(`Session ${sessionId} not found.`);
  process.exit(1);
}

async function doResume(targetRepo: string, sessionDir: string): Promise<void> {
  // Claim this session by writing our PID
  await update(sessionDir, { pid: process.pid, session_status: 'active' });

  // Discard incomplete runtime files
  const runtimeDir = join(sessionDir, 'runtime');
  await rm(join(runtimeDir, 'output.md'), { force: true });
  await rm(join(runtimeDir, 'prompt.md'), { force: true });

  // Clean orphaned .tmp files in turns/ (from crashes between write and rename)
  const turnsDir = join(sessionDir, 'turns');
  try {
    const files = await readdir(turnsDir);
    const tmpFiles = files.filter(f => f.endsWith('.tmp'));
    await Promise.all(tmpFiles.map(f => unlink(join(turnsDir, f))));
    if (tmpFiles.length > 0) {
      console.log(`Cleaned ${tmpFiles.length} orphaned .tmp file(s) from turns/`);
    }
  } catch { /* turns dir may not exist */ }

  // Load session and resume
  const session = await load(sessionDir);

  // If session has an active worktree (implement/review in progress), validate the path
  // structurally and verify it exists on disk before using it as target_repo.
  if (session.worktree_path && (session.phase === 'implement' || session.phase === 'review')) {
    if (isDefWorktreePath(session.worktree_path) && await worktreeExists(session.worktree_path)) {
      session.target_repo = session.worktree_path;
    } else {
      // Worktree is required for implement/review — refuse to resume in main checkout
      console.error(`Error: worktree ${session.worktree_path} invalid or missing. Cannot safely resume implement/review in main checkout.`);
      console.error(`Session ${session.id} marked as completed. Branch may still exist: ${session.branch_name || '(unknown)'}`);
      await update(sessionDir, { session_status: 'completed' });
      return;
    }
  } else {
    session.target_repo = targetRepo;
  }
  // Always use the known-good targetRepo as original_repo, not the persisted value
  session.original_repo = targetRepo;

  installShutdownHandler(sessionDir, targetRepo, session);

  let server: typeof import('./server.js') | null = null;
  try {
    server = await import('./server.js');
  } catch {
    // Headless mode
  }

  try {
    await run(session, { server });
  } catch (err: unknown) {
    console.error(`Orchestrator error: ${(err as Error).message}`);
  } finally {
    if (server) {
      await new Promise((r) => setTimeout(r, 5000));
      server.stop();
    }
  }
}
