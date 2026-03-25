import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load, listTurnFiles } from './session.js';
import { validate } from './validation.js';

interface ParsedTurn {
  from: string;
  turn: number;
  timestamp: string;
  status: string;
  content: string;
  valid: boolean;
  raw: string;
}

async function loadTurns(sessionDir: string): Promise<ParsedTurn[]> {
  const turnsDir = join(sessionDir, 'turns');
  const files = await listTurnFiles(turnsDir);
  const turns: ParsedTurn[] = [];

  for (const file of files) {
    const raw = await readFile(join(turnsDir, file), 'utf8');
    const result = validate(raw);
    if (result.valid && result.data) {
      turns.push({
        from: result.data.from,
        turn: result.data.turn,
        timestamp: result.data.timestamp,
        status: result.data.status,
        content: result.content,
        valid: true,
        raw,
      });
    } else {
      turns.push({
        from: 'unknown',
        turn: 0,
        timestamp: '',
        status: 'error',
        content: raw,
        valid: false,
        raw,
      });
    }
  }

  return turns;
}

async function loadArtifact(sessionDir: string, name: string): Promise<string | null> {
  try {
    return await readFile(join(sessionDir, 'artifacts', name), 'utf8');
  } catch {
    return null;
  }
}

export async function exportMarkdown(sessionDir: string): Promise<string> {
  const session = await load(sessionDir);
  const turns = await loadTurns(sessionDir);
  const decisions = await loadArtifact(sessionDir, 'decisions.md');
  const plan = await loadArtifact(sessionDir, 'plan.md');

  const lines: string[] = [];

  // Header
  lines.push(`# ${session.topic}`);
  lines.push('');
  lines.push(`- **Session ID:** ${session.id}`);
  lines.push(`- **Date:** ${session.created}`);
  lines.push(`- **Mode:** ${session.mode}`);
  lines.push(`- **Status:** ${session.session_status}`);
  lines.push(`- **Phase:** ${session.phase}`);
  lines.push(`- **Turns:** ${turns.length}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Turns
  for (const turn of turns) {
    if (turn.valid) {
      lines.push(`## Turn ${turn.turn} -- ${turn.from}`);
      lines.push(`*${turn.timestamp} | status: ${turn.status}*`);
      lines.push('');
      lines.push(turn.content);
    } else {
      lines.push('## Turn (corrupted)');
      lines.push('> Warning: Could not parse frontmatter for this turn.');
      lines.push('');
      lines.push(turn.content);
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Appendices
  if (decisions) {
    lines.push('## Appendix: Decisions');
    lines.push('');
    lines.push(decisions);
    lines.push('');
  }

  if (plan) {
    lines.push('## Appendix: Plan');
    lines.push('');
    lines.push(plan);
    lines.push('');
  }

  return lines.join('\n');
}

function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const AGENT_COLORS: Record<string, string> = {
  claude: '#3b82f6',
  codex: '#22c55e',
  human: '#8b5cf6',
  system: '#6b7280',
};

export async function exportHtml(sessionDir: string): Promise<string> {
  const session = await load(sessionDir);
  const turns = await loadTurns(sessionDir);

  const turnSections = turns.map(turn => {
    const borderColor = AGENT_COLORS[turn.from] ?? AGENT_COLORS.system;
    const heading = turn.valid
      ? `<h2>Turn ${turn.turn} &mdash; ${escapeHtml(turn.from)}</h2><p class="meta">${escapeHtml(turn.timestamp)} | status: ${escapeHtml(turn.status)}</p>`
      : `<h2>Turn (corrupted)</h2><p class="meta warning">Could not parse frontmatter</p>`;
    return `<section style="border-left: 4px solid ${borderColor}">${heading}<div class="content"><pre>${escapeHtml(turn.content)}</pre></div></section>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(session.topic)} - DEF Transcript</title>
<style>
  :root { --bg: #fff; --fg: #1a1a2e; --muted: #6b7280; --border: #e5e7eb; --pre-bg: #f3f4f6; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #0f172a; --fg: #e2e8f0; --muted: #94a3b8; --border: #334155; --pre-bg: #1e293b; }
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--fg); max-width: 900px; margin: 0 auto; padding: 2rem 1rem; line-height: 1.6; }
  header { margin-bottom: 2rem; border-bottom: 2px solid var(--border); padding-bottom: 1rem; }
  header h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
  header .meta { color: var(--muted); font-size: 0.875rem; }
  section { margin-bottom: 1.5rem; padding: 1rem 1rem 1rem 1.25rem; border-radius: 0.25rem; background: var(--pre-bg); }
  section h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
  .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 0.75rem; }
  .warning { color: #ef4444; }
  pre { white-space: pre-wrap; word-wrap: break-word; font-size: 0.875rem; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; }
  footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: 0.8rem; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(session.topic)}</h1>
  <p class="meta">Session ${escapeHtml(session.id.slice(0, 8))} | ${escapeHtml(session.created)} | ${escapeHtml(session.mode)} mode | ${escapeHtml(session.session_status)} | ${turns.length} turns</p>
</header>
<main>
${turnSections}
</main>
<footer>Exported from DEF (Dueling Experts Framework)</footer>
</body>
</html>`;
}
