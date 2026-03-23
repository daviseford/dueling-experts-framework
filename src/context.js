import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listTurnFiles } from './session.js';

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };

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

  const turns = await Promise.all(
    turnFiles.map((file) => readFile(join(turnsDir, file), 'utf8'))
  );

  // Assemble
  const parts = [
    planningPrompt(next_agent, topic),
    '',
    '## Session Brief',
    `**Topic:** ${topic}`,
    `**Mode:** ${mode}`,
    '',
  ];

  if (turns.length > 0) {
    parts.push('## Prior Turns');
    for (const turn of turns) {
      parts.push(turn);
      parts.push('');
    }
  }

  parts.push('## Your Turn');
  parts.push(
    'Respond with YAML frontmatter followed by your markdown response. Required frontmatter fields: id, turn, from, timestamp, status. Optional: decisions (array of strings).'
  );

  return parts.join('\n');
}
