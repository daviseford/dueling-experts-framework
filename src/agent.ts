import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assemble } from './context.js';
import { killChildProcess } from './util.js';
import type { Session, AgentName } from './session.js';

// ── Type definitions ────────────────────────────────────────────────

interface AgentConfig {
  cmd: string;
  args: string[] | ((outputPath: string) => string[]);
  implementArgs?: string[];
  reviewArgs?: string[];
  captureStdout: boolean;
}

export interface InvokeResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  error?: string;
}

const TIMEOUT_MS = 300_000; // 5 minutes for plan/review
const IMPLEMENT_TIMEOUT_MS = 900_000; // 15 minutes for implement — agents produce full file contents
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB — prevent OOM from runaway agent output

const FAST_MODELS = {
  claude: 'haiku',
  codex: 'o4-mini',
} as const satisfies Record<AgentName, string>;

const AGENTS: Record<AgentName, AgentConfig> = {
  claude: {
    cmd: 'claude',
    args: ['--print'],
    // In implement phase, use -p with tool access. The assembled prompt is piped
    // to stdin as context; the -p argument is a short instruction.
    implementArgs: [
      '-p',
      'Execute the implementation task described in the context provided via stdin. You have full tool access. When you are done, output a brief markdown summary of what you changed.',
      '--allowedTools', '*',
      '--dangerously-skip-permissions',
    ],
    // In plan/review phases when tool access is needed (e.g. reading GitHub PRs).
    // Scoped to gh CLI only — agents cannot modify files.
    reviewArgs: [
      '-p',
      'Respond to the task described in the context provided via stdin. You have access to the gh CLI for reading GitHub data. Output your response as YAML frontmatter followed by markdown.',
      '--allowedTools', 'Bash(gh:*)',
      '--dangerously-skip-permissions',
    ],
    captureStdout: true,
  },
  codex: {
    cmd: 'codex',
    args: (outputPath: string) => [
      'exec',
      '--full-auto',
      '--skip-git-repo-check',
      '-o', outputPath,
    ],
    // Codex already has native tool access via --full-auto
    captureStdout: false,
  },
};

/**
 * Invoke an agent CLI with the assembled prompt.
 * Returns { exitCode, output, timedOut }.
 */
export async function invoke(agentName: AgentName, session: Session, tier?: 'full' | 'fast'): Promise<InvokeResult> {
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

  // Build args — select phase-specific args when available
  let args: string[];
  if (session.phase === 'implement' && config.implementArgs) {
    args = config.implementArgs;
  } else if ((session.phase === 'plan' || session.phase === 'review') && config.reviewArgs) {
    args = config.reviewArgs;
  } else if (typeof config.args === 'function') {
    args = config.args(outputPath);
  } else {
    args = config.args;
  }

  // Append --model flag when using the fast tier
  if (tier === 'fast') {
    args = [...args, '--model', FAST_MODELS[agentName]];
  }

  const startTime = Date.now();
  const logPrefix = `${agentName}-${Date.now()}`;

  return new Promise<InvokeResult>((resolve) => {
    // On Windows, npm-installed CLIs are .cmd shims that require shell.
    // All args are controlled by us (never user input), so this is safe.
    // We join command + args into a single shell string to avoid DEP0190
    // (Node warns when shell:true + non-empty args array).
    const useShell = process.platform === 'win32';
    const child: ChildProcess = useShell
      ? spawn(
          [config.cmd, ...args.map(a => a.includes(' ') ? `"${a}"` : a)].join(' '),
          [],
          { cwd: session.target_repo, stdio: ['pipe', 'pipe', 'pipe'], shell: true },
        )
      : spawn(config.cmd, args, {
          cwd: session.target_repo, stdio: ['pipe', 'pipe', 'pipe'],
        });

    // Expose child for SIGINT cleanup (stored on session object)
    session._currentChild = child;

    // Pipe prompt file to stdin. Using createReadStream + pipe ensures EOF
    // is signaled properly when the file is fully read.
    // stdin.write() + end() produced 0 bytes on Windows in testing.
    const promptStream = createReadStream(promptPath);
    promptStream.pipe(child.stdin!);

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_BYTES) {
        killChildProcess(child);
      }
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      timedOut = true;
      killChildProcess(child);
      setTimeout(() => {
        try { killChildProcess(child, 'SIGKILL'); } catch { /* already dead */ }
      }, 5000);
    }, session.phase === 'implement' ? IMPLEMENT_TIMEOUT_MS : TIMEOUT_MS);

    function settle(result: InvokeResult): void {
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
        '=== STDERR (first 8000 chars) ===',
        stderr.slice(0, 8000) || '(empty)',
        '',
        stderr.length > 8000 ? '=== STDERR (last 2000 chars) ===' : null,
        stderr.length > 8000 ? stderr.slice(-2000) : null,
      ].filter(Boolean).join('\n');

      writeFile(join(logsDir, `${logPrefix}.log`), log, 'utf8').catch(() => {});

      resolve(result);
    }

    child.on('close', async (exitCode: number | null) => {
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

    child.on('error', (err: Error) => {
      settle({ exitCode: 1, output: '', timedOut: false, error: err.message });
    });
  });
}
