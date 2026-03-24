import { open, rename } from 'node:fs/promises';

/**
 * Write a file atomically: write to .tmp, fsync, then rename.
 * Ensures data is durable on disk before the final path is visible.
 */
export async function atomicWrite(finalPath: string, content: string): Promise<void> {
  const tmpPath = finalPath + '.tmp';
  const fh = await open(tmpPath, 'w');
  try {
    await fh.writeFile(content, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmpPath, finalPath);
}

/**
 * Check if a process with the given PID is still alive.
 * Cross-platform: works on both Unix and Windows.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'; // alive but no permission to signal
  }
}
