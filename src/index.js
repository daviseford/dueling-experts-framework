import { resolve } from 'node:path';
import { create, releaseLock, installShutdownHandler } from './session.js';
import { run } from './orchestrator.js';

const VALID_MODES = ['planning'];
const VALID_AGENTS = ['claude', 'codex'];

// Parse and validate CLI args
const args = process.argv.slice(2);
const opts = parseArgs(args);

if (!opts.topic && !opts.resume) {
  console.error('Usage: acb --topic "Your topic" [--mode planning] [--max-turns 20] [--first claude|codex]');
  console.error('       acb --resume <session-id>');
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

const targetRepo = resolve(process.cwd());

// Handle --resume
if (opts.resume) {
  const { resumeSession } = await import('./recovery.js');
  await resumeSession(targetRepo, opts.resume);
  process.exit(0);
}

// Check for recoverable sessions
try {
  const { checkForRecovery } = await import('./recovery.js');
  const result = await checkForRecovery(targetRepo);
  if (result === true) {
    process.exit(0);
  }
  if (result && result.multiple) {
    console.log('Multiple interrupted sessions found:\n');
    for (const s of result.sessions) {
      console.log(`  ${s.id}  (turn ${s.current_turn}, ${s.session_status})`);
      console.log(`    Topic: ${s.topic}\n`);
    }
    console.log('Use --resume <session-id> to resume one.');
    process.exit(1);
  }
} catch {
  // recovery module not loaded — continue
}

// Create new session
let session;
try {
  session = await create({
    topic: opts.topic,
    mode: opts.mode || 'planning',
    maxTurns: opts.maxTurns || 20,
    firstAgent: opts.first || 'claude',
    targetRepo,
  });
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}

console.log(`Session created: ${session.id}`);
console.log(`Topic: ${session.topic}`);
console.log(`Mode: ${session.mode}`);
console.log(`Max turns: ${session.max_turns}`);
console.log(`First agent: ${session.next_agent}`);
console.log(`Session dir: ${session.dir}`);
console.log('');

installShutdownHandler(session.dir, targetRepo);

// Start server
let server = null;
try {
  server = await import('./server.js');
} catch {
  // Headless mode
}

// Run the turn loop
try {
  await run(session, { server });
} catch (err) {
  console.error(`Orchestrator error: ${err.message}`);
  process.exitCode = 1;
} finally {
  await releaseLock(targetRepo);
  if (server) server.stop();
  process.exit(process.exitCode || 0);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--topic':
        result.topic = argv[++i];
        break;
      case '--mode':
        result.mode = argv[++i];
        break;
      case '--max-turns':
        result.maxTurns = parseInt(argv[++i], 10);
        break;
      case '--first':
        result.first = argv[++i];
        break;
      case '--resume':
        result.resume = argv[++i];
        break;
    }
  }
  return result;
}
