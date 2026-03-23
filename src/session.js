import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Create a new session directory and session.json.
 * Acquires a lockfile — errors if one already exists.
 */
export async function create({ topic, mode, maxTurns, firstAgent, targetRepo }) {
  const acbDir = join(targetRepo, '.acb');
  const lockPath = join(acbDir, 'lock');

  // Ensure .acb/ exists
  await mkdir(acbDir, { recursive: true });

  // Acquire lockfile
  try {
    await access(lockPath);
    throw new Error(
      'A session may already be running. Delete .acb/lock to proceed.'
    );
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  await writeFile(lockPath, String(process.pid), 'utf8');

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
 * Write JSON atomically: write to .tmp then rename.
 */
export async function atomicWriteJson(filePath, data) {
  const tmpPath = filePath + '.tmp';
  await writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmpPath, filePath);
}

/**
 * Remove the lockfile.
 */
export async function releaseLock(targetRepo) {
  const lockPath = join(targetRepo, '.acb', 'lock');
  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(lockPath);
  } catch {
    // Already removed or doesn't exist — fine
  }
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
