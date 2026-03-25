import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, installShutdownHandler } from './session.js';
import type { Session, AgentName } from './session.js';
import { run } from './orchestrator.js';
import { parseArgs } from './cli.js';

const VALID_MODES = ['edit', 'planning'];
const VALID_AGENTS = ['claude', 'codex'];

// Parse and validate CLI args
const args: string[] = process.argv.slice(2);
const opts = parseArgs(args);

if (opts.version) {
  const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (!opts.topic) {
  console.error('Usage: def <topic>');
  console.error('       def --topic "Your topic" [--mode edit|planning] [--max-turns 20] [--first claude|codex] [--impl-model claude|codex] [--review-turns 6] [--no-pr]');
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
if (opts.first && !VALID_AGENTS.includes(opts.first)) {
  console.error(`Error: --first must be one of: ${VALID_AGENTS.join(', ')}`);
  process.exit(1);
}
if (opts.implModel && !VALID_AGENTS.includes(opts.implModel)) {
  console.error(`Error: --impl-model must be one of: ${VALID_AGENTS.join(', ')}`);
  process.exit(1);
}
if (opts.reviewTurns !== undefined) {
  if (isNaN(opts.reviewTurns) || opts.reviewTurns < 1 || opts.reviewTurns > 50) {
    console.error('Error: --review-turns must be a number between 1 and 50');
    process.exit(1);
  }
}

const targetRepo = resolve(process.cwd());

// Create new session
let session: Session;
try {
  session = await create({
    topic: opts.topic!,
    mode: opts.mode || 'edit',
    maxTurns: opts.maxTurns || 20,
    firstAgent: (opts.first || 'claude') as AgentName,
    implModel: (opts.implModel || 'claude') as AgentName,
    reviewTurns: opts.reviewTurns || 6,
    targetRepo,
  });
} catch (err: unknown) {
  console.error(`Error: ${(err as Error).message}`);
  process.exit(1);
}

console.log(`Session created: ${session.id}`);
console.log(`Topic: ${session.topic}`);
console.log(`Mode: ${session.mode}`);
console.log(`Max turns: ${session.max_turns}`);
console.log(`First agent: ${session.next_agent}`);
console.log(`Impl model: ${session.impl_model}`);
console.log(`Review turns: ${session.review_turns}`);
console.log(`Session dir: ${session.dir}`);
console.log('');

installShutdownHandler(session.dir, targetRepo, session);

// Start server
let server: typeof import('./server.js') | null = null;
try {
  server = await import('./server.js');
} catch {
  // Headless mode
}

// Run the turn loop
try {
  await run(session, { server, noPr: opts.noPr });
} catch (err: unknown) {
  console.error(`Orchestrator error: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  if (server) {
    // Give the UI time to poll the completed status before shutting down
    await new Promise((r) => setTimeout(r, 5000));
    server.stop();
  }
  process.exit(process.exitCode || 0);
}
