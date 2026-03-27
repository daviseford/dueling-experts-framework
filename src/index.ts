import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, installShutdownHandler } from './session.js';
import type { Session } from './session.js';
import { registerRepo } from './registry.js';
import { run } from './orchestrator.js';
import { parseArgs } from './cli.js';
import { listProviders, getProvider } from './agent.js';
import { preflight } from './preflight.js';
import { buildDefaultRoster, buildRoster } from './roster.js';
import * as ui from './ui.js';

// Subcommand routing -- check before parseArgs
const subcmd = process.argv[2];
if (subcmd === 'history') {
  const mod = await import('./history-cmd.js');
  await mod.run(process.argv.slice(3));
  process.exit(0);
}
if (subcmd === 'show') {
  const mod = await import('./show-cmd.js');
  await mod.run(process.argv.slice(3));
  process.exit(0);
}
if (subcmd === 'explorer') {
  const mod = await import('./explorer-cmd.js');
  await mod.run(process.argv.slice(3));
  process.exit(0);
}

const VALID_MODES = ['edit', 'planning'];

// Parse and validate CLI args
const args: string[] = process.argv.slice(2);
let opts;
try {
  opts = parseArgs(args);
} catch (err: unknown) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}

if (opts.version) {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (!opts.topic) {
  const providers = listProviders().join(', ');
  console.error('Usage: def <topic>');
  console.error(`       def --topic "Your topic" [--mode edit|planning] [--max-turns 20] [--first ${providers}] [--impl-model ${providers}] [--agents ${providers}] [--budget 5.00] [--review-turns 6] [--dry-run] [--no-pr] [--no-fast] [--no-worktree]`);
  console.error('       def history [--status <s>] [--topic <t>] [--since <d>] [--before <d>] [--limit <n>] [--json]');
  console.error('       def show <session-id-or-prefix>');
  console.error('       def explorer [--idle-timeout <seconds>] [--port <number>]');
  process.exit(1);
}

// Validate options
if (opts.maxTurns !== undefined) {
  if (isNaN(opts.maxTurns) || opts.maxTurns < 1 || opts.maxTurns > 100) {
    console.error('Error: --max-turns must be a number between 1 and 100');
    process.exit(1);
  }
}
if (opts.mode && !VALID_MODES.includes(opts.mode)) {
  console.error(`Error: --mode must be one of: ${VALID_MODES.join(', ')}`);
  process.exit(1);
}

// Validate agent names against the provider registry
const registeredProviders = listProviders();

if (opts.first && !registeredProviders.includes(opts.first)) {
  console.error(`Error: --first must be one of: ${registeredProviders.join(', ')}`);
  process.exit(1);
}
if (opts.implModel && !registeredProviders.includes(opts.implModel)) {
  console.error(`Error: --impl-model must be one of: ${registeredProviders.join(', ')}`);
  process.exit(1);
}

// Parse --agents flag (comma-separated provider names)
let agentsList: string[] | undefined;
if (opts.agents) {
  agentsList = opts.agents.split(',').map(a => a.trim());
  if (agentsList.length < 2) {
    console.error('Error: --agents requires at least 2 comma-separated provider names (e.g., --agents claude,codex)');
    process.exit(1);
  }
  for (const agent of agentsList) {
    if (!registeredProviders.includes(agent)) {
      console.error(`Error: unknown agent "${agent}" in --agents. Available: ${registeredProviders.join(', ')}`);
      process.exit(1);
    }
  }
}

if (opts.reviewTurns !== undefined) {
  if (isNaN(opts.reviewTurns) || opts.reviewTurns < 1 || opts.reviewTurns > 50) {
    console.error('Error: --review-turns must be a number between 1 and 50');
    process.exit(1);
  }
}
if (opts.budget !== undefined) {
  if (isNaN(opts.budget) || opts.budget <= 0) {
    console.error('Error: --budget must be a positive number (USD)');
    process.exit(1);
  }
}

// Build display name map from registry
const displayNames: Record<string, string> = {};
for (const name of registeredProviders) {
  const provider = getProvider(name);
  if (provider) displayNames[name] = provider.displayName;
}

const targetRepo = resolve(process.cwd());
const firstAgent = opts.first || 'claude';

if (opts.dryRun) {
  const roster = agentsList
    ? buildRoster(agentsList, opts.implModel || 'claude', displayNames)
    : buildDefaultRoster(firstAgent, opts.implModel || 'claude', displayNames);

  console.log(ui.dryRunPreview({
    topic: opts.topic,
    mode: opts.mode || 'edit',
    targetRepo,
    maxTurns: opts.maxTurns || 20,
    reviewTurns: opts.reviewTurns || 6,
    roster,
    noPr: !!opts.noPr,
    noWorktree: !!opts.noWorktree,
    budget: opts.budget,
  }));
  process.exit(0);
}

// Determine which providers will be used (for preflight CLI checks).
// Must mirror buildDefaultRoster logic: the second agent is the first
// registered provider that differs from firstAgent (or firstAgent itself
// for self-debate when only one provider is registered).
const preflightAgents = agentsList
  ? [...new Set(agentsList)]
  : [...new Set([firstAgent, registeredProviders.find(a => a !== firstAgent) ?? firstAgent])];

// Preflight: validate CLIs, git state, and GitHub auth before spending credits
await preflight({
  agents: preflightAgents,
  noPr: !!opts.noPr,
  mode: opts.mode || 'edit',
});

// Create new session
let session: Session;
try {
  session = await create({
    topic: opts.topic!,
    mode: opts.mode || 'edit',
    maxTurns: opts.maxTurns || 20,
    firstAgent: opts.first || 'claude',
    implModel: opts.implModel || 'claude',
    reviewTurns: opts.reviewTurns || 6,
    targetRepo,
    agents: agentsList,
    budget: opts.budget,
    displayNames,
  });
} catch (err: unknown) {
  ui.error((err as Error).message);
  process.exit(1);
}

// Register repo in global known-repos (fire-and-forget)
registerRepo(targetRepo).catch(() => {});

ui.intro({
  id: session.id,
  topic: session.topic,
  mode: session.mode,
  max_turns: session.max_turns,
  next_agent: session.next_agent,
  impl_model: session.impl_model,
  review_turns: session.review_turns,
  dir: session.dir,
  noPr: opts.noPr,
});

ui.status('cost.estimate', {
  maxTurns: session.max_turns,
  budget: session.budget,
});

installShutdownHandler(session.dir, targetRepo, session);

// Probe for an existing shared server before starting our own
let server: typeof import('./server.js') | null = null;
let ownsServer = false;
try {
  server = await import('./server.js');

  const defaultPort = server.getDefaultPort();
  if (defaultPort === 0) {
    // CI or DEF_NO_OPEN -- skip probe, start our own server
    ownsServer = true;
  } else {
    const probe = await server.probeExistingServer(defaultPort);

    if (probe.action === 'join') {
      // A shared DEF server with active sessions exists -- run headless
      ui.status('server.shared', { port: defaultPort });
      server = null;
      ownsServer = false;
    } else {
      // 'replace' or 'bind-new' -- start our own server
      // For 'replace', the probe already sent end-session to the stale server
      ownsServer = true;
    }
  }
} catch {
  // Headless mode -- server module unavailable
}

// Start the server if we own it
if (server && ownsServer) {
  // server.start() is called by the orchestrator via the server reference
}

// Run the turn loop
try {
  await run(session, { server, noPr: opts.noPr, noFast: opts.noFast, noWorktree: opts.noWorktree });
} catch (err: unknown) {
  ui.error(`Orchestrator error: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  if (server && ownsServer) {
    // Keep server alive for multi-session browsing after session completes.
    // Server shuts down after idle timeout (default 5 minutes).
    try {
      await server.beginIdleShutdown();
    } catch {
      server.stop();
    }
  }
  process.exit(process.exitCode || 0);
}
