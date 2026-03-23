import { spawn } from 'node:child_process';
import { writeFile, readFile, open } from 'node:fs/promises';
import { join } from 'node:path';
import { assemble } from './context.js';

const TIMEOUT_MS = 120_000; // 120 seconds

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
      '--no-project-doc',
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
  const promptPath = join(runtimeDir, 'prompt.md');
  const outputPath = join(runtimeDir, 'output.md');

  // Write assembled prompt
  const prompt = await assemble(session);
  await writeFile(promptPath, prompt, 'utf8');

  // Build args
  const args = typeof config.args === 'function'
    ? config.args(outputPath)
    : config.args;

  // Open prompt file as readable fd for stdin
  const fd = await open(promptPath, 'r');
  const stdinStream = fd.createReadStream();

  try {
    return await new Promise((resolve) => {
      const child = spawn(config.cmd, args, {
        cwd: session.target_repo,
        stdio: [stdinStream, 'pipe', 'ignore'], // stderr ignored (Codex thinking tokens)
        shell: false, // Security invariant: NEVER shell: true
      });

      let stdout = '';
      let timedOut = false;
      let settled = false;

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
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
  } finally {
    await fd.close();
  }
}
