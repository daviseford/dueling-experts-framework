import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, mkdir, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { atomicWrite } from './util.js';

const SHELL_TIMEOUT_MS = 60_000;
const SHELL_MAX_OUTPUT = 5 * 1024 * 1024;
const MAX_PATH_LENGTH = 500;

export interface Action {
  type: string;
  path?: string;
  cmd?: string;
  cwd?: string;
  search?: string;
  body?: string;
}

export interface ActionResult {
  action: Action;
  ok: boolean;
  error?: string;
  output?: string;
}

/**
 * Parse def-action blocks from agent turn content.
 * Returns array of action objects: { type, path?, cmd?, cwd?, search?, body? }
 */
export function parseActions(content: string): Action[] {
  const actions: Action[] = [];
  const regex = /```def-action\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const block = match[1];
    const action = parseActionBlock(block);
    if (action) actions.push(action);
  }

  return actions;
}

function parseActionBlock(block: string): Action | null {
  // Split on first "---\n" to separate header from body
  const dividerIdx = block.indexOf('---\n');
  let headerStr: string;
  let body: string | null;

  if (dividerIdx !== -1) {
    headerStr = block.slice(0, dividerIdx);
    body = block.slice(dividerIdx + 4);
    // Trim trailing newline from body (the closing ``` adds one)
    if (body.endsWith('\n')) body = body.slice(0, -1);
  } else {
    headerStr = block;
    body = null;
  }

  // Parse YAML-like key: value pairs from header
  const header: Record<string, string> = {};
  for (const line of headerStr.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) header[key] = value;
  }

  if (!header.type) return null;

  const action: Action = { type: header.type };
  if (header.path) action.path = header.path;
  if (header.cmd) action.cmd = header.cmd;
  if (header.cwd) action.cwd = header.cwd;
  if (header.search) action.search = header.search;
  if (body !== null) action.body = body;

  return action;
}

/**
 * Validate that a path is safe (no traversal outside targetRepo).
 * Checks both lexical resolution and realpath (symlink) resolution.
 * Returns the resolved absolute path or throws.
 */
async function safePath(targetRepo: string, filePath: string): Promise<string> {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Path is required and must be a non-empty string');
  }
  if (filePath.length > MAX_PATH_LENGTH) {
    throw new Error(`Path exceeds ${MAX_PATH_LENGTH} character limit`);
  }
  if (filePath.includes('\0')) {
    throw new Error('Path contains null byte');
  }
  if (isAbsolute(filePath)) {
    throw new Error(`Absolute paths not allowed: ${filePath}`);
  }

  const resolved = resolve(targetRepo, filePath);
  const rel = relative(targetRepo, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal rejected: ${filePath}`);
  }

  // Resolve symlinks on the existing portion of the path to prevent symlink traversal.
  // Walk up from the resolved path to find the deepest existing ancestor,
  // then verify it's still within targetRepo.
  const realRepo = await realpath(targetRepo);
  let check = resolved;
  while (check !== dirname(check)) {
    try {
      const real = await realpath(check);
      const realRel = relative(realRepo, real);
      if (realRel.startsWith('..') || isAbsolute(realRel)) {
        throw new Error(`Path traversal via symlink rejected: ${filePath}`);
      }
      break;
    } catch (err: unknown) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Path doesn't exist yet — check parent
        check = dirname(check);
        continue;
      }
      throw err;
    }
  }

  return resolved;
}

/**
 * Execute a list of parsed actions against a target repo.
 * Returns array of { action, ok, error?, output? }.
 */
export async function executeActions(actions: Action[], targetRepo: string): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'write-file': {
          if (!action.path) throw new Error('write-file requires a "path" field');
          const dest = await safePath(targetRepo, action.path);
          await mkdir(dirname(dest), { recursive: true });
          await atomicWrite(dest, action.body ?? '');
          results.push({ action, ok: true });
          break;
        }

        case 'edit-file': {
          if (!action.path) throw new Error('edit-file requires a "path" field');
          const dest = await safePath(targetRepo, action.path);
          const existing = await readFile(dest, 'utf8');
          if (!action.search) {
            throw new Error('edit-file requires a "search" field');
          }
          if (!existing.includes(action.search)) {
            throw new Error(`Search string not found in ${action.path}`);
          }
          // Use function form to prevent $-pattern interpretation in replacement
          const updated = existing.replace(action.search, () => action.body ?? '');
          await atomicWrite(dest, updated);
          results.push({ action, ok: true });
          break;
        }

        case 'shell': {
          if (!action.cmd) {
            throw new Error('shell action requires a "cmd" field');
          }
          const cwd = action.cwd
            ? await safePath(targetRepo, action.cwd)
            : targetRepo;
          console.log(`[action] shell: ${action.cmd}`);
          const output = await runShell(action.cmd, cwd);
          results.push({ action, ok: true, output });
          break;
        }

        case 'mkdir': {
          if (!action.path) throw new Error('mkdir requires a "path" field');
          const dest = await safePath(targetRepo, action.path);
          await mkdir(dest, { recursive: true });
          results.push({ action, ok: true });
          break;
        }

        default:
          results.push({ action, ok: false, error: `Unknown action type: ${action.type}` });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ action, ok: false, error: message });
    }
  }

  return results;
}

interface FinishArg {
  error?: Error;
  output?: string;
}

function runShell(cmd: string, cwd: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const child: ChildProcess = spawn(cmd, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killedForOutput = false;

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > SHELL_MAX_OUTPUT) {
        killedForOutput = true;
        child.kill('SIGTERM');
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < SHELL_MAX_OUTPUT) {
        stderr += chunk.toString();
      }
    });

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`Shell command timed out after ${SHELL_TIMEOUT_MS}ms: ${cmd}`));
    }, SHELL_TIMEOUT_MS);

    function finish(result: FinishArg): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (result.error) {
        reject(result.error);
      } else {
        resolve(result.output!);
      }
    }

    child.on('close', (exitCode: number | null) => {
      if (killedForOutput) {
        finish({ error: new Error(`Shell command output exceeded ${SHELL_MAX_OUTPUT} bytes: ${cmd}`) });
      } else if (exitCode !== 0) {
        finish({ error: new Error(`Shell command failed (exit ${exitCode}): ${stderr.slice(0, 500) || stdout.slice(0, 500)}`) });
      } else {
        finish({ output: stdout });
      }
    });

    child.on('error', (err: Error) => {
      finish({ error: err });
    });
  });
}
