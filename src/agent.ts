import { spawn, type ChildProcess } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { assemble } from './context.js';
import { killChildProcess } from './util.js';
import type { Session } from './session.js';
import type { TokenUsage } from './cost.js';
import { parseClaudeUsage, parseCodexUsage } from './cost.js';

// ── Type definitions ────────────────────────────────────────────────

type Args = string[] | ((outputPath: string) => string[]);

export type ModelTier = 'full' | 'mid' | 'fast';

/**
 * Provider configuration -- defines how to invoke a CLI agent backend.
 * Replaces the old AgentConfig + model maps + display names.
 */
export interface ProviderConfig {
  /** CLI command name (e.g., 'claude', 'codex'). */
  cmd: string;

  /** Default args for generic invocation. */
  args: Args;

  /** Args for implement phase (full tool access). */
  implementArgs?: Args;

  /** Args for plan/review phase (read-only access). */
  reviewArgs?: Args;

  /** Whether to capture output from stdout (true) or output file (false). */
  captureStdout: boolean;

  /** Model names by tier. 'full' is required; 'mid' and 'fast' fall back to 'full'. */
  models: {
    full: string;
    mid?: string;
    fast?: string;
  };

  /** Display name for UI and prompts (e.g., 'Claude', 'Codex'). */
  displayName: string;

  /** Extract token usage from CLI output. Returns null if not available. */
  parseUsage?: (stdout: string, stderr: string) => TokenUsage | null;
}

export interface InvokeResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
  error?: string;
  usage?: TokenUsage;
}

const TIMEOUT_MS = 900_000; // 15 minutes per agent invocation
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // 5 MB -- prevent OOM from runaway agent output

// ── Built-in providers ──────────────────────────────────────────────

const builtinProviders: Record<string, ProviderConfig> = {
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
    // No Edit, Write, or general Bash -- agents can observe but not modify.
    reviewArgs: [
      '-p',
      'Respond to the task described in the context provided via stdin. You have read-only tool access for research. Output your response as YAML frontmatter followed by markdown.',
      '--allowedTools',
      'Read', 'Glob', 'Grep',
      'Bash(gh:*)', 'Bash(git log *)', 'Bash(git diff *)', 'Bash(git show *)', 'Bash(ls *)',
      '--dangerously-skip-permissions',
    ],
    captureStdout: true,
    models: {
      full: 'opus',
      mid: 'sonnet',
      fast: 'haiku',
    },
    displayName: 'Claude',
    parseUsage: parseClaudeUsage,
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
    models: {
      full: 'gpt-5.4',
      fast: 'gpt-5.1-codex-mini',
    },
    displayName: 'Codex',
    parseUsage: parseCodexUsage,
  },
};

// ── Provider registry ───────────────────────────────────────────────

const providers: Record<string, ProviderConfig> = { ...builtinProviders };

/** Register a new agent provider. */
export function registerProvider(name: string, config: ProviderConfig): void {
  providers[name] = config;
}

/** Look up a provider by name. Returns undefined if not registered. */
export function getProvider(name: string): ProviderConfig | undefined {
  return providers[name];
}

/** List all registered provider names. */
export function listProviders(): string[] {
  return Object.keys(providers);
}

/** Resolve the model name for a given provider and tier. */
export function resolveModelName(agent: string, tier: ModelTier): string {
  const provider = getProvider(agent);
  if (!provider) throw new Error(`Unknown agent: "${agent}"`);
  if (tier === 'fast' && provider.models.fast) return provider.models.fast;
  if (tier === 'mid' && provider.models.mid) return provider.models.mid;
  return provider.models.full;
}

/**
 * Resolve the model name for a participant, using their provider from the roster.
 * Falls back to treating the name as a provider name directly.
 */
export function resolveModelForParticipant(participantId: string, session: Session, tier: ModelTier): string {
  const roster = session.roster;
  if (roster) {
    const participant = roster.find(p => p.id === participantId);
    if (participant) return resolveModelName(participant.provider, tier);
  }
  return resolveModelName(participantId, tier);
}

// ── invoke ──────────────────────────────────────────────────────────

/**
 * Invoke an agent CLI with the assembled prompt.
 * Resolves the provider via the session roster (if present) or by direct name lookup.
 * Returns { exitCode, output, timedOut, usage }.
 */
export async function invoke(agentName: string, session: Session, tier?: ModelTier): Promise<InvokeResult> {
  // Resolve provider: check roster first, then direct lookup
  let providerName = agentName;
  if (session.roster) {
    const participant = session.roster.find(p => p.id === agentName);
    if (participant) providerName = participant.provider;
  }

  const config = providers[providerName];
  if (!config) {
    throw new Error(`Unknown agent: "${agentName}" (provider: "${providerName}"). Registered: ${listProviders().join(', ')}`);
  }

  const runtimeDir = join(session.dir, 'runtime');
  const logsDir = join(session.dir, 'logs');
  const promptPath = join(runtimeDir, 'prompt.md');
  const outputPath = join(runtimeDir, 'output.md');

  await mkdir(logsDir, { recursive: true });

  // Write assembled prompt
  const prompt = await assemble(session);
  await writeFile(promptPath, prompt, 'utf8');

  // Build args -- select phase-specific args when available
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
    const model = resolveModelName(providerName, tier);
    if (model !== config.models.full) {
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
    }, TIMEOUT_MS);

    function settle(result: InvokeResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      // Extract token usage from CLI output (best-effort)
      if (config.parseUsage) {
        try {
          result.usage = config.parseUsage(stdout, stderr) ?? undefined;
        } catch {
          // Token parsing failure is non-fatal
        }
      }

      // Write debug log to disk
      const elapsed = Date.now() - startTime;
      const usageLog = result.usage
        ? `tokenUsage: in=${result.usage.input_tokens ?? '?'} out=${result.usage.output_tokens ?? '?'}`
        : 'tokenUsage: (not available)';
      const log = [
        `agent: ${agentName}`,
        `provider: ${providerName}`,
        `cmd: ${config.cmd} ${args.join(' ')}`,
        `cwd: ${session.target_repo}`,
        `exitCode: ${result.exitCode}`,
        `timedOut: ${result.timedOut}`,
        `elapsed: ${elapsed}ms`,
        usageLog,
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
