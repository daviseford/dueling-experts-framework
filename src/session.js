import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicWrite } from './util.js';

/**
 * Create a new session directory and session.json.
 * Acquires a lockfile — errors if one already exists.
 */
export async function create({ topic, mode, maxTurns, firstAgent, targetRepo }) {
  const acbDir = join(targetRepo, '.acb');
  const lockPath = join(acbDir, 'lock');

  // Ensure .acb/ exists
  await mkdir(acbDir, { recursive: true });

  // Acquire lockfile atomically (wx = exclusive create, fails if exists)
  await acquireLock(lockPath);

  // Create session directory
  const id = randomUUID();
  const sessionDir = join(acbDir, 'sessions', id);
  await mkdir(join(sessionDir, 'turns'), { recursive: true });
  await mkdir(join(sessionDir, 'artifacts'), { recursive: true });
  await mkdir(join(sessionDir, 'runtime'), { recursive: true });

  const session = {
    id,
    topic,
    mode,
    max_turns: maxTurns,
    target_repo: targetRepo,
    created: new Date().toISOString(),
    session_status: 'active',
    current_turn: 0,
    next_agent: firstAgent,
    port: null,
  };

  await atomicWriteJson(join(sessionDir, 'session.json'), session);

  // Add .acb/ to .gitignore if not already present
  await ensureGitignore(targetRepo);

  return { ...session, dir: sessionDir, lockPath };
}

/**
 * Load an existing session from its directory.
 */
export async function load(sessionDir) {
  const raw = await readFile(join(sessionDir, 'session.json'), 'utf8');
  return { ...JSON.parse(raw), dir: sessionDir };
}

/**
 * Atomically update session.json (write temp → rename).
 */
export async function update(sessionDir, fields) {
  const sessionPath = join(sessionDir, 'session.json');
  const raw = await readFile(sessionPath, 'utf8');
  const session = { ...JSON.parse(raw), ...fields };
  await atomicWriteJson(sessionPath, session);
  return session;
}

/**
 * Write JSON atomically with fsync via shared utility.
 */
async function atomicWriteJson(filePath, data) {
  await atomicWrite(filePath, JSON.stringify(data, null, 2) + '\n');
}

/**
 * Remove the lockfile.
 */
export async function releaseLock(targetRepo) {
  const lockPath = join(targetRepo, '.acb', 'lock');
  try {
    await unlink(lockPath);
  } catch {
    // Already removed or doesn't exist — fine
  }
}

/**
 * Install a SIGINT handler for clean shutdown.
 * Sets session to 'interrupted' (recoverable) and kills child processes.
 */
export function installShutdownHandler(sessionDir, targetRepo, session = null) {
  let shuttingDown = false;
  process.on('SIGINT', async () => {
    if (shuttingDown) process.exit(1); // Double Ctrl+C — hard exit
    shuttingDown = true;
    console.log('\nShutting down gracefully...');
    try {
      // Kill the running agent child process
      const child = session?._currentChild;
      if (child && !child.killed) {
        if (process.platform === 'win32') {
          import('node:child_process').then(({ exec }) => {
            exec(`taskkill /pid ${child.pid} /T /F`);
          }).catch(() => {});
        } else {
          child.kill('SIGTERM');
        }
      }

      await update(sessionDir, { session_status: 'interrupted' });
      await releaseLock(targetRepo);
    } catch { /* best effort */ }
    process.exit(0);
  });
}

/**
 * Acquire a lockfile atomically. Fails if already exists.
 */
export async function acquireLock(lockPath) {
  try {
    await writeFile(lockPath, String(process.pid), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      throw new Error('A session may already be running. Delete .acb/lock to proceed.');
    }
    throw err;
  }
}

/**
 * List canonical turn files in a session's turns directory, sorted by turn number.
 */
export async function listTurnFiles(turnsDir) {
  const { readdir } = await import('node:fs/promises');
  let files = [];
  try {
    files = await readdir(turnsDir);
  } catch {
    return [];
  }
  return files
    .filter((f) => f.startsWith('turn-') && f.endsWith('.md') && !f.endsWith('.tmp'))
    .sort();
}

async function ensureGitignore(targetRepo) {
  const gitignorePath = join(targetRepo, '.gitignore');
  let content = '';
  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch {
    // No .gitignore — we'll create one
  }
  if (!content.includes('.acb/') && !content.includes('.acb\n')) {
    const line = content.endsWith('\n') || content === '' ? '.acb/\n' : '\n.acb/\n';
    await writeFile(gitignorePath, content + line, 'utf8');
  }
}
