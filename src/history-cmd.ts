import { resolve } from 'node:path';
import pc from 'picocolors';
import { listSessions } from './session.js';
import type { SessionSummaryInfo } from './session.js';

interface HistoryArgs {
  status?: string;
  topic?: string;
  since?: string;
  before?: string;
  limit: number;
  json: boolean;
}

function parseHistoryArgs(argv: string[]): HistoryArgs {
  const result: HistoryArgs = { limit: 20, json: false };

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--status':
        result.status = argv[++i];
        break;
      case '--topic':
        result.topic = argv[++i];
        break;
      case '--since':
        result.since = argv[++i];
        break;
      case '--before':
        result.before = argv[++i];
        break;
      case '--limit':
        result.limit = parseInt(argv[++i], 10) || 20;
        break;
      case '--json':
        result.json = true;
        break;
    }
  }

  return result;
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed': return pc.green(status);
    case 'active': return pc.cyan(status);
    case 'interrupted': return pc.yellow(status);
    case 'paused': return pc.yellow(status);
    default: return status;
  }
}

function phaseBadge(phase: string): string {
  switch (phase) {
    case 'plan': return pc.cyan(phase.padEnd(10));
    case 'implement': return pc.green(phase.padEnd(10));
    case 'review': return pc.magenta(phase.padEnd(10));
    default: return phase.padEnd(10);
  }
}

export async function run(argv: string[]): Promise<void> {
  const args = parseHistoryArgs(argv);
  const targetRepo = resolve(process.cwd());

  let sessions = await listSessions(targetRepo);

  if (sessions.length === 0) {
    console.log('No sessions found. Run `def <topic>` to start a session.');
    return;
  }

  // Apply filters
  if (args.status) {
    sessions = sessions.filter(s => s.session_status === args.status);
  }
  if (args.topic) {
    const needle = args.topic.toLowerCase();
    sessions = sessions.filter(s => s.topic.toLowerCase().includes(needle));
  }
  if (args.since) {
    const sinceDate = new Date(args.since).toISOString();
    sessions = sessions.filter(s => s.created >= sinceDate);
  }
  if (args.before) {
    const beforeDate = new Date(args.before).toISOString();
    sessions = sessions.filter(s => s.created < beforeDate);
  }

  // Apply limit
  sessions = sessions.slice(0, args.limit);

  if (args.json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  if (sessions.length === 0) {
    console.log('No sessions match the filters.');
    return;
  }

  // Table header
  const header = `${pc.bold('ID'.padEnd(10))}${pc.bold('Topic'.padEnd(32))}${pc.bold('Date'.padEnd(14))}${pc.bold('Phase'.padEnd(12))}${pc.bold('Turns'.padEnd(7))}${pc.bold('Status'.padEnd(14))}${pc.bold('PR')}`;
  console.log(header);
  console.log(pc.dim('-'.repeat(95)));

  for (const s of sessions) {
    const id = s.id.slice(0, 8).padEnd(10);
    const topic = s.topic.slice(0, 30).padEnd(32);
    const date = formatDate(s.created).padEnd(14);
    const phase = phaseBadge(s.phase).padEnd(12);
    const turns = String(s.current_turn).padEnd(7);
    const status = statusColor(s.session_status).padEnd(14);
    const pr = s.pr_url ? pc.cyan(`#${extractPrNumber(s.pr_url)}`) : pc.dim('-');
    console.log(`${id}${topic}${date}${phase}${turns}${status}${pr}`);
  }

  console.log('');
  console.log(pc.dim(`${sessions.length} session(s)`));
}

function formatDate(iso: string): string {
  if (!iso) return '(unknown)';
  try {
    const d = new Date(iso);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  } catch {
    return iso.slice(0, 10);
  }
}

function extractPrNumber(url: string): string {
  const match = url.match(/\/(\d+)$/);
  return match ? match[1] : url;
}
