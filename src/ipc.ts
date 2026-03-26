import { mkdir, readdir, readFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicWrite } from './util.js';

// ── Interjections ──────────────────────────────────────────────────

/**
 * Write an interjection file into a session's interjections/ directory.
 * Filename: `<epoch-ms>-<randomHex(4)>.json` for chronological sort + uniqueness.
 */
export async function writeInterjection(sessionDir: string, content: string): Promise<void> {
  const dir = join(sessionDir, 'interjections');
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${randomBytes(4).toString('hex')}.json`;
  await atomicWrite(join(dir, name), JSON.stringify({ content }) + '\n');
}

/**
 * Read all pending interjections from a session's interjections/ directory.
 * Returns content strings sorted by filename (chronological).
 * Consumed files are deleted after reading; ENOENT/EPERM errors are handled gracefully.
 */
export async function readInterjections(sessionDir: string): Promise<string[]> {
  const dir = join(sessionDir, 'interjections');
  let files: string[];
  try {
    files = await readdir(dir);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }

  // Explicit sort — do not rely on readdir order
  files.sort();

  const contents: string[] = [];
  for (const file of files) {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) continue;
    const filePath = join(dir, file);
    try {
      const raw = await readFile(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      contents.push(parsed.content);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw e;
    }
    // Delete consumed file
    await unlinkSafe(filePath);
  }

  return contents;
}

// ── End-session request ────────────────────────────────────────────

/**
 * Write an `end-requested` sentinel file to signal session termination.
 */
export async function writeEndRequest(sessionDir: string): Promise<void> {
  await atomicWrite(join(sessionDir, 'end-requested'), '');
}

/**
 * Check if an `end-requested` file exists. If found, deletes it and returns true.
 */
export async function checkEndRequest(sessionDir: string): Promise<boolean> {
  const filePath = join(sessionDir, 'end-requested');
  try {
    await stat(filePath);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  // File exists — consume it
  await unlinkSafe(filePath);
  return true;
}

// ── Helpers ────────────────────────────────────────────────────────

const EPERM_RETRIES = 3;
const EPERM_DELAY_MS = 50;

/**
 * Unlink a file, silently ignoring ENOENT (already deleted).
 * On Windows, EPERM can occur when another process holds the file — retry a few times.
 */
async function unlinkSafe(filePath: string): Promise<void> {
  for (let attempt = 0; attempt <= EPERM_RETRIES; attempt++) {
    try {
      await unlink(filePath);
      return;
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return;
      if (code === 'EPERM' && attempt < EPERM_RETRIES) {
        await new Promise(r => setTimeout(r, EPERM_DELAY_MS));
        continue;
      }
      throw e;
    }
  }
}
