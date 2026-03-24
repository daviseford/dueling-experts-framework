import { open, rename } from 'node:fs/promises';
import { exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

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
 * Kill a child process tree cross-platform.
 * On Windows, uses taskkill /T /F to kill the entire process tree
 * (necessary because shell:true spawns a cmd.exe wrapper).
 */
export function killChildProcess(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child || child.killed || !child.pid) return;
  if (process.platform === 'win32') {
    exec(`taskkill /pid ${child.pid} /T /F`);
  } else {
    child.kill(signal);
  }
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
