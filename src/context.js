import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listTurnFiles } from './session.js';
import { validate } from './validation.js';

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };

// Budget: ~100K tokens × 4 chars/token = 400K chars.
// Reserve headroom for the model's response.
const CHAR_BUDGET = 400_000;

function planningPrompt(agent, topic) {
  const other = agent === 'claude' ? 'Codex' : 'Claude';
  return `You are ${AGENT_NAMES[agent]}, participating in a structured planning conversation with another AI agent (${other}).
You are collaborating on: ${topic}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "${agent}"), timestamp (ISO-8601), status (complete | needs_human | done).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and BOTH agents have contributed, set status: done. Do NOT set done on your first turn — the other agent must have a chance to respond.
- Always use status: complete unless the conversation is truly finished after multiple turns.
- Do NOT include anything before the opening --- of the frontmatter.`;
}

/**
 * Assemble the full prompt for an agent invocation.
 * Uses a character budget to prevent exceeding model context windows.
 * Oldest turns are dropped first; their decisions are preserved in a summary.
 */
export async function assemble(session) {
  const { topic, mode, next_agent, dir } = session;

  if (mode !== 'planning') {
    throw new Error(`Unknown mode: "${mode}". Supported: planning`);
  }
  if (!AGENT_NAMES[next_agent]) {
    throw new Error(`Unknown agent: "${next_agent}". Supported: claude, codex`);
  }

  // Read all existing turns
  const turnsDir = join(dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);

  const turnContents = await Promise.all(
    turnFiles.map(async (file) => {
      const raw = await readFile(join(turnsDir, file), 'utf8');
      const parsed = validate(raw);
      return {
        raw,
        turn: parsed.data?.turn,
        from: parsed.data?.from,
        decisions: parsed.data?.decisions || [],
      };
    })
  );

  // Build fixed parts (always included)
  const systemPrompt = planningPrompt(next_agent, topic);
  const sessionBrief = `## Session Brief\n**Topic:** ${topic}\n**Mode:** ${mode}\n`;
  const yourTurn = '## Your Turn\nRespond with YAML frontmatter followed by your markdown response. Required frontmatter fields: id, turn, from, timestamp, status. Optional: decisions (array of strings).';

  const fixedChars = systemPrompt.length + sessionBrief.length + yourTurn.length + 20; // newlines
  let remaining = CHAR_BUDGET - fixedChars;

  // Include turns newest-first until budget is exhausted
  const included = [];
  const truncated = [];

  for (let i = turnContents.length - 1; i >= 0; i--) {
    const turnLen = turnContents[i].raw.length + 2; // + newlines
    if (turnLen <= remaining) {
      included.unshift(turnContents[i]);
      remaining -= turnLen;
    } else {
      truncated.unshift(turnContents[i]);
    }
  }

  // Assemble
  const parts = [systemPrompt, '', sessionBrief, ''];

  // Add truncation notice if turns were dropped
  if (truncated.length > 0) {
    const decisions = truncated.flatMap(t => t.decisions);
    parts.push(buildTruncationNotice(truncated, decisions));
    parts.push('');
  }

  if (included.length > 0) {
    parts.push('## Prior Turns');
    for (const turn of included) {
      parts.push(turn.raw);
      parts.push('');
    }
  }

  parts.push(yourTurn);

  return parts.join('\n');
}

/**
 * Build a summary notice for turns that were truncated due to context budget.
 */
function buildTruncationNotice(truncated, decisions) {
  const first = truncated[0].turn ?? '?';
  const last = truncated[truncated.length - 1].turn ?? '?';
  const lines = [
    `> **[Context truncated]** Turns ${first}–${last} omitted (${truncated.length} turn(s), ${decisions.length} decision(s) preserved).`,
  ];

  if (decisions.length > 0) {
    lines.push('> **Decisions from truncated turns:**');
    for (const d of decisions) {
      lines.push(`> - ${d}`);
    }
  }

  return lines.join('\n');
}
