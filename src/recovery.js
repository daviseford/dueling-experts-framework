import { readdir, readFile, access, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './orchestrator.js';
import { load, releaseLock, acquireLock, installShutdownHandler } from './session.js';
import { isProcessAlive } from './util.js';

/**
 * Check for recoverable sessions on startup.
 * Returns true if a session was auto-resumed, false otherwise.
 */
export async function checkForRecovery(targetRepo) {
  const sessionsDir = join(targetRepo, '.def', 'sessions');
  const lockPath = join(targetRepo, '.def', 'lock');

  // If lockfile exists, check whether the owning process is still alive
  try {
    await access(lockPath);
    const pidStr = await readFile(lockPath, 'utf8');
    const pid = parseInt(pidStr.trim(), 10);
    if (!isNaN(pid) && isProcessAlive(pid)) {
      return false; // Another session is genuinely running
    }
    // Stale lockfile — owning process is dead, clean it up
    console.log('Detected stale lockfile (process no longer running). Removing.');
    await unlink(lockPath);
  } catch {
    // No lockfile — can proceed with recovery check
  }

  let sessionDirs;
  try {
    sessionDirs = await readdir(sessionsDir);
  } catch {
    return false; // No sessions directory
  }

  const recoverable = [];

  for (const dirName of sessionDirs) {
    const sessionDir = join(sessionsDir, dirName);
    const sessionPath = join(sessionDir, 'session.json');

    try {
      const raw = await readFile(sessionPath, 'utf8');
      const data = JSON.parse(raw);

      if (data.session_status === 'active' || data.session_status === 'paused' || data.session_status === 'interrupted') {
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
export async function resumeSession(targetRepo, sessionId) {
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

async function doResume(targetRepo, sessionDir) {
  // Acquire lockfile atomically
  const lockPath = join(targetRepo, '.def', 'lock');
  await acquireLock(lockPath);

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
  session.target_repo = targetRepo;

  installShutdownHandler(sessionDir, targetRepo, session);

  let server = null;
  try {
    server = await import('./server.js');
  } catch {
    // Headless mode
  }

  try {
    await run(session, { server });
  } catch (err) {
    console.error(`Orchestrator error: ${err.message}`);
  } finally {
    await releaseLock(targetRepo);
    if (server) {
      await new Promise((r) => setTimeout(r, 5000));
      server.stop();
    }
  }
}
