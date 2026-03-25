import { resolve } from 'node:path';
import { findSessionDir, load } from './session.js';

export async function run(argv: string[]): Promise<void> {
  const sessionId = argv[0];

  if (!sessionId) {
    console.error('Usage: def show <session-id-or-prefix>');
    process.exit(1);
  }

  const targetRepo = resolve(process.cwd());
  const sessionDir = await findSessionDir(targetRepo, sessionId);

  if (!sessionDir) {
    console.error(`Error: no unique session found for prefix "${sessionId}"`);
    process.exit(1);
  }

  const session = await load(sessionDir);

  // Start server in read-only mode
  const server = await import('./server.js');
  await server.startReadOnly(session);

  console.log(`Viewing session ${session.id.slice(0, 8)}: ${session.topic}`);
  console.log('Press Ctrl+C to stop.');

  // Keep process alive until SIGINT
  await new Promise<void>((done) => {
    process.on('SIGINT', () => {
      server.stop();
      done();
    });
  });
}
