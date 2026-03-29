import { resolve } from 'node:path';
import { access } from 'node:fs/promises';
import { listKnownRepos } from './registry.js';

interface ExplorerArgs {
  idleTimeout: number;
  port: number | undefined;
}

function parseExplorerArgs(argv: string[]): ExplorerArgs {
  const result: ExplorerArgs = { idleTimeout: 300, port: undefined };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--idle-timeout':
        result.idleTimeout = parseInt(argv[++i], 10) || 300;
        break;
      case '--port':
        result.port = parseInt(argv[++i], 10) || 0;
        break;
    }
  }
  return result;
}


/**
 * `def explorer` — standalone multi-session browser UI.
 * Starts the watcher server without creating a session.
 * Works from any directory — aggregates sessions from all known repos.
 */
export async function run(argv: string[]): Promise<void> {
  const args = parseExplorerArgs(argv);

  // Check if CWD has local sessions; if not, verify that any known repos exist
  const cwd = resolve(process.cwd());
  let hasLocalSessions = false;
  try {
    await access(resolve(cwd, '.def', 'sessions'));
    hasLocalSessions = true;
  } catch { /* no local sessions */ }

  if (!hasLocalSessions) {
    const repos = await listKnownRepos();
    if (repos.length === 0) {
      console.log('No DEF sessions found anywhere.');
      console.log('Run `def <topic>` in a git repo to start a session first.');
      process.exit(0);
    }
  }

  // Import server dynamically (same pattern as index.ts)
  let server: typeof import('./server.js');
  try {
    server = await import('./server.js');
  } catch {
    console.error('Could not load server module.');
    process.exit(1);
    return; // unreachable, satisfies TS
  }

  // Probe for an existing DEF server on the default port
  const preferredPort = args.port ?? 18541;
  const probe = await server.probeExistingServer(preferredPort);
  if (probe.action === 'join') {
    // Existing DEF server found with active sessions — reuse it
    const url = `http://localhost:${preferredPort}`;
    console.log(`DEF server already running at ${url}`);
    const openCmd = process.platform === 'win32' ? 'start'
      : process.platform === 'darwin' ? 'open' : 'xdg-open';
    if (!process.env.CI && !process.env.DEF_NO_OPEN) {
      const { exec } = await import('node:child_process');
      exec(`${openCmd} ${url}`);
    }
    process.exit(0);
    return; // unreachable, satisfies TS
  }

  console.log('Starting explorer mode...');

  // Start server in global explorer mode (no targetRepo — aggregates all known repos)
  await server.startExplorer(undefined, {
    idleTimeout: args.idleTimeout,
    port: preferredPort,
  });

  // Wait for SIGINT or idle timeout
  await new Promise<void>((r) => {
    process.on('SIGINT', () => {
      server.stop();
      r();
    });
  });
}
