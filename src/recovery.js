import { readdir, readFile, writeFile, access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './orchestrator.js';
import { load, releaseLock, installShutdownHandler } from './session.js';

/**
 * Check for recoverable sessions on startup.
 * Returns true if a session was auto-resumed, false otherwise.
 */
export async function checkForRecovery(targetRepo) {
  const sessionsDir = join(targetRepo, '.acb', 'sessions');
  const lockPath = join(targetRepo, '.acb', 'lock');

  // If lockfile exists, another session may be running — skip recovery
  try {
    await access(lockPath);
    return false;
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

      if (data.session_status === 'active' || data.session_status === 'paused') {
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

  // Multiple recoverable sessions — print list and exit
  console.log('Multiple interrupted sessions found:\n');
  for (const s of recoverable) {
    console.log(`  ${s.id}  (turn ${s.current_turn}, ${s.session_status})`);
    console.log(`    Topic: ${s.topic}\n`);
  }
  console.log('Use --resume <session-id> to resume one.');
  process.exit(1);
}

/**
 * Resume a specific session by ID.
 */
export async function resumeSession(targetRepo, sessionId) {
  const sessionsDir = join(targetRepo, '.acb', 'sessions');

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
  // Acquire lockfile
  const lockPath = join(targetRepo, '.acb', 'lock');
  await writeFile(lockPath, String(process.pid), 'utf8');

  // Discard incomplete runtime files
  const runtimeDir = join(sessionDir, 'runtime');
  await rm(join(runtimeDir, 'output.md'), { force: true });
  await rm(join(runtimeDir, 'prompt.md'), { force: true });

  // Load session and resume
  const session = await load(sessionDir);
  session.target_repo = targetRepo;

  installShutdownHandler(sessionDir, targetRepo);

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
  }
}
