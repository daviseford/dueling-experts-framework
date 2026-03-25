import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assemble } from './context.js';
import { killChildProcess } from './util.js';
import type { Session, AgentName, TokenUsage, ModelTier } from './session.js';

// ── Type definitions ────────────────────────────────────────────────

type Args = string[] | ((outputPath: string) => string[]);

interface AgentConfig {
  cmd: string;
  args: Args;
  implementArgs?: Args;
  reviewArgs?: Args;
  captureStdout: boolean;
}

export interface InvokeResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  error?: string;
  tokenUsage?: TokenUsage;
}

export function parseTokenUsage(stderr: string): TokenUsage | undefined {
  // Claude CLI: JSON object with input_tokens
  const jsonMatch = stderr.match(/\{[^}]*"input_tokens"\s*:\s*\d+[^}]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (typeof parsed.input_tokens === 'number') {
        return {
          input_tokens: parsed.input_tokens,
          output_tokens: parsed.output_tokens ?? 0,
          cache_creation_input_tokens: parsed.cache_creation_input_tokens,
          cache_read_input_tokens: parsed.cache_read_input_tokens,
        };
      }
    } catch { /* malformed JSON */ }
  }

  // Codex CLI: "1,234 input ... 567 output"
  const codexMatch = stderr.match(/(\d[\d,]*)\s*input.*?(\d[\d,]*)\s*output/i);
  if (codexMatch) {
    return {
      input_tokens: parseInt(codexMatch[1].replace(/,/g, ''), 10),
      output_tokens: parseInt(codexMatch[2].replace(/,/g, ''), 10),
    };
  }

  return undefined;
}

const TIMEOUT_MS = 300_000; // 5 minutes for plan/review
const IMPLEMENT_TIMEOUT_MS = 900_000; // 15 minutes for implement — agents produce full file contents
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB — prevent OOM from runaway agent output

export type { ModelTier } from './session.js';

const DEFAULT_MODELS: Record<AgentName, string> = {
  claude: 'opus',
  codex: 'gpt-5.4',
};

const MID_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'sonnet',
};

const FAST_MODELS: Partial<Record<AgentName, string>> = {
  claude: 'haiku',
  codex: 'gpt-5.1-codex-mini',
};

/** Resolve the model name for a given agent and tier. */
export function resolveModelName(agent: AgentName, tier: ModelTier): string {
  if (tier === 'fast') return FAST_MODELS[agent] ?? DEFAULT_MODELS[agent];
  if (tier === 'mid') return MID_MODELS[agent] ?? DEFAULT_MODELS[agent];
  return DEFAULT_MODELS[agent];
}

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
    // In plan/review phases: read-only tool access for research and analysis.
    // No Edit, Write, or general Bash — agents can observe but not modify.
    reviewArgs: [
      '-p',
      'Respond to the task described in the context provided via stdin. You have read-only tool access for research. Output your response as YAML frontmatter followed by markdown.',
      '--allowedTools',
      'Read', 'Glob', 'Grep',
      'Bash(gh:*)', 'Bash(git log *)', 'Bash(git diff *)', 'Bash(git show *)', 'Bash(ls *)',
      '--dangerously-skip-permissions',
    ],
    captureStdout: true,
  },
  codex: {
    cmd: 'codex',
    args: (outputPath: string) => [
      'exec',
      '--full-auto',
      '--ephemeral',
      '--skip-git-repo-check',
      '-o', outputPath,
    ],
    // In plan/review phases: read-only sandbox, no file modifications.
    reviewArgs: (outputPath: string) => [
      'exec',
      '--sandbox', 'read-only',
      '--ephemeral',
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
export async function invoke(agentName: AgentName, session: Session, tier?: ModelTier): Promise<InvokeResult> {
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
  const resolve = (a: Args): string[] => typeof a === 'function' ? a(outputPath) : a;
  let args: string[];
  if (session.phase === 'implement' && config.implementArgs) {
    args = resolve(config.implementArgs);
  } else if ((session.phase === 'plan' || session.phase === 'review') && config.reviewArgs) {
    args = resolve(config.reviewArgs);
  } else {
    args = resolve(config.args);
  }

  // Append --model flag when not using the default (full) tier
  if (tier && tier !== 'full') {
    const model = resolveModelName(agentName, tier);
    if (model !== DEFAULT_MODELS[agentName]) {
      args = [...args, '--model', model];
    }
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
      const tokenUsage = parseTokenUsage(stderr);
      settle({ exitCode: exitCode ?? 1, output, timedOut, tokenUsage });
    });

    child.on('error', (err: Error) => {
      settle({ exitCode: 1, output: '', timedOut: false, error: err.message });
    });
  });
}
