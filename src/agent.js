import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assemble } from './context.js';

const TIMEOUT_MS = 180_000; // 180 seconds — claude --print can take 90-120s for large prompts
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB — prevent OOM from runaway agent output

const AGENTS = {
  claude: {
    cmd: 'claude',
    args: ['--print'],
    captureStdout: true,
  },
  codex: {
    cmd: 'codex',
    args: (outputPath) => [
      'exec',
      '--full-auto',
      '--skip-git-repo-check',
      '-o', outputPath,
    ],
    captureStdout: false,
  },
};

/**
 * Invoke an agent CLI with the assembled prompt.
 * Returns { exitCode, output, timedOut }.
 */
export async function invoke(agentName, session) {
  const config = AGENTS[agentName];
  if (!config) {
    throw new Error(`Unknown agent: "${agentName}". Supported: claude, codex`);
  }

  const runtimeDir = join(session.dir, 'runtime');
  const logsDir = join(session.dir, 'logs');
  const promptPath = join(runtimeDir, 'prompt.md');
  const outputPath = join(runtimeDir, 'output.md');

  await mkdir(logsDir, { recursive: true });

  // Write assembled prompt
  const prompt = await assemble(session);
  await writeFile(promptPath, prompt, 'utf8');

  // Build args
  const args = typeof config.args === 'function'
    ? config.args(outputPath)
    : config.args;

  const startTime = Date.now();
  const logPrefix = `${agentName}-${Date.now()}`;

  return new Promise((resolve) => {
    const child = spawn(config.cmd, args, {
      cwd: session.target_repo,
      stdio: ['pipe', 'pipe', 'pipe'], // capture stderr for debugging
      // On Windows, npm-installed CLIs are .cmd shims that require shell.
      // All args are controlled by us (never user input), so this is safe.
      shell: process.platform === 'win32',
    });

    // Expose child for SIGINT cleanup (stored on session object)
    if (session._currentChild !== undefined) {
      session._currentChild = child;
    }

    // Pipe prompt file to stdin. Using createReadStream + pipe ensures EOF
    // is signaled properly when the file is fully read.
    // stdin.write() + end() produced 0 bytes on Windows in testing.
    const promptStream = createReadStream(promptPath);
    promptStream.pipe(child.stdin);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        child.kill('SIGTERM');
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, TIMEOUT_MS);

    function settle(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Write debug log to disk
      const elapsed = Date.now() - startTime;
      const log = [
        `agent: ${agentName}`,
        `cmd: ${config.cmd} ${args.join(' ')}`,
        `cwd: ${session.target_repo}`,
        `exitCode: ${result.exitCode}`,
        `timedOut: ${result.timedOut}`,
        `elapsed: ${elapsed}ms`,
        `stdoutLength: ${stdout.length}`,
        `stderrLength: ${stderr.length}`,
        result.error ? `spawnError: ${result.error}` : null,
        '',
        '=== STDOUT (first 2000 chars) ===',
        stdout.slice(0, 2000) || '(empty)',
        '',
        '=== STDERR (first 2000 chars) ===',
        stderr.slice(0, 2000) || '(empty)',
      ].filter(Boolean).join('\n');

      writeFile(join(logsDir, `${logPrefix}.log`), log, 'utf8').catch(() => {});

      resolve(result);
    }

    child.on('close', async (exitCode) => {
      let output = '';
      if (config.captureStdout) {
        output = stdout;
      } else {
        try {
          output = await readFile(outputPath, 'utf8');
        } catch {
          output = '';
        }
      }
      settle({ exitCode: exitCode ?? 1, output, timedOut });
    });

    child.on('error', (err) => {
      settle({ exitCode: 1, output: '', timedOut: false, error: err.message });
    });
  });
}
