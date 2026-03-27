/**
 * src/preflight.ts -- Unified preflight validation.
 *
 * Runs before session creation to fail fast on missing prerequisites.
 * Checks agent CLIs, git state, and GitHub auth so users get clear
 * errors before any API credits are spent.
 */

import { execFile } from 'node:child_process';
import { getProvider } from './agent.js';

export interface PreflightOptions {
  /** Provider names that will be used (e.g., ['claude', 'codex']). */
  agents: string[];
  /** Whether --no-pr was passed (skips gh/remote checks). */
  noPr: boolean;
  /** Session mode ('edit' or 'planning'). */
  mode: string;
}

/**
 * Run all preflight checks. Prints a specific error and exits on failure.
 * Must be called before session.create() in src/index.ts.
 */
export async function preflight(opts: PreflightOptions): Promise<void> {
  const errors: string[] = [];

  // 1. Check that each agent CLI is installed and responds
  const uniqueProviders = [...new Set(opts.agents)];
  for (const name of uniqueProviders) {
    const provider = getProvider(name);
    if (!provider) continue; // already validated by index.ts
    const ok = await checkCommand(provider.cmd);
    if (!ok) {
      errors.push(
        `'${provider.cmd}' CLI not found on PATH. Install it before running def.\n` +
        installHint(provider.cmd),
      );
    }
  }

  // 2. Check that we're inside a git repository
  const inGitRepo = await checkCommand('git', ['rev-parse', '--show-toplevel']);
  if (!inGitRepo) {
    errors.push(
      'Not inside a git repository. Run def from within a git repo.',
    );
  }

  // 3. For edit mode with PR creation, check gh auth and remote
  if (opts.mode === 'edit' && !opts.noPr) {
    const hasRemote = await checkCommand('git', ['remote', 'get-url', 'origin']);
    if (!hasRemote) {
      errors.push(
        "No 'origin' remote configured. Add one with 'git remote add origin <url>' or use --no-pr.",
      );
    }

    const ghInstalled = await checkCommand('gh', ['--version']);
    if (!ghInstalled) {
      errors.push(
        "'gh' CLI not found on PATH. Install it from https://cli.github.com or use --no-pr.",
      );
    } else {
      const ghAuthed = await checkCommand('gh', ['auth', 'status']);
      if (!ghAuthed) {
        errors.push(
          "GitHub CLI not authenticated. Run 'gh auth login' or use --no-pr.",
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error('');
    console.error('Preflight checks failed:');
    console.error('');
    for (const err of errors) {
      console.error(`  x ${err}`);
      console.error('');
    }
    process.exit(1);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function checkCommand(cmd: string, args: string[] = ['--version']): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 10_000, shell: process.platform === 'win32' }, (err) => {
      resolve(!err);
    });
  });
}

function installHint(cmd: string): string {
  switch (cmd) {
    case 'claude':
      return '  See: https://docs.anthropic.com/en/docs/claude-code';
    case 'codex':
      return '  See: https://github.com/openai/codex';
    default:
      return '';
  }
}
