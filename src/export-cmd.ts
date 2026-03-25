import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
import { findSessionDir, listSessions } from './session.js';
import { exportMarkdown, exportHtml } from './export.js';

interface ExportArgs {
  sessionId?: string;
  format: 'md' | 'html';
  output?: string;
  list: boolean;
}

function parseExportArgs(argv: string[]): ExportArgs {
  const result: ExportArgs = { format: 'md', list: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--format':
        result.format = argv[++i] as 'md' | 'html';
        break;
      case '--output':
        result.output = argv[++i];
        break;
      case '--list':
        result.list = true;
        break;
      default:
        if (!argv[i].startsWith('--')) {
          result.sessionId = argv[i];
        }
        break;
    }
  }

  return result;
}

export async function run(argv: string[]): Promise<void> {
  const args = parseExportArgs(argv);
  const targetRepo = resolve(process.cwd());

  if (args.list) {
    const sessions = await listSessions(targetRepo);
    if (sessions.length === 0) {
      console.log('No sessions found.');
      return;
    }
    console.log('ID        Topic                          Date                  Phase      Turns  Status');
    console.log('-'.repeat(95));
    for (const s of sessions) {
      const id = s.id.slice(0, 8);
      const topic = s.topic.slice(0, 30).padEnd(30);
      const date = s.created.slice(0, 19).padEnd(21);
      const phase = s.phase.padEnd(10);
      const turns = String(s.current_turn).padEnd(6);
      console.log(`${id}  ${topic}  ${date}  ${phase}  ${turns}  ${s.session_status}`);
    }
    return;
  }

  if (!args.sessionId) {
    console.error('Usage: def export <session-id> [--format md|html] [--output <path>] [--list]');
    process.exit(1);
  }

  if (args.format !== 'md' && args.format !== 'html') {
    console.error('Error: --format must be md or html');
    process.exit(1);
  }

  const sessionDir = await findSessionDir(targetRepo, args.sessionId);
  if (!sessionDir) {
    console.error(`Error: no unique session found for prefix "${args.sessionId}"`);
    process.exit(1);
  }

  const content = args.format === 'html'
    ? await exportHtml(sessionDir)
    : await exportMarkdown(sessionDir);

  if (args.output) {
    writeFileSync(resolve(args.output), content, 'utf8');
    console.log(`Exported to ${args.output}`);
  } else if (args.format === 'html') {
    const shortId = args.sessionId.slice(0, 8);
    const filename = `transcript-${shortId}.html`;
    writeFileSync(resolve(filename), content, 'utf8');
    console.log(`Exported to ${filename}`);
  } else {
    process.stdout.write(content);
  }
}
