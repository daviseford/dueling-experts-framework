import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROLE_PROMPTS = {
  planning: {
    claude: (topic) => `You are Claude, participating in a structured planning conversation with another AI agent (Codex).
You are collaborating on: ${topic}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "claude"), timestamp (ISO-8601), status (complete | needs_human | done).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and ready for implementation, set status: done.
- Do NOT include anything before the opening --- of the frontmatter.`,

    codex: (topic) => `You are Codex, participating in a structured planning conversation with another AI agent (Claude).
You are collaborating on: ${topic}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "codex"), timestamp (ISO-8601), status (complete | needs_human | done).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and ready for implementation, set status: done.
- Do NOT include anything before the opening --- of the frontmatter.`,
  },
};

/**
 * Assemble the full prompt for an agent invocation.
 */
export async function assemble(session) {
  const { topic, mode, next_agent, dir } = session;

  // Role prompt
  const modePrompts = ROLE_PROMPTS[mode];
  if (!modePrompts) {
    throw new Error(`Unknown mode: "${mode}". Supported: planning`);
  }
  const rolePrompt = modePrompts[next_agent];
  if (!rolePrompt) {
    throw new Error(`No role prompt for agent "${next_agent}" in mode "${mode}"`);
  }

  // Read all existing turns
  const turnsDir = join(dir, 'turns');
  let turnFiles = [];
  try {
    turnFiles = await readdir(turnsDir);
  } catch {
    // No turns yet
  }
  turnFiles = turnFiles
    .filter((f) => f.startsWith('turn-') && f.endsWith('.md'))
    .sort();

  const turns = [];
  for (const file of turnFiles) {
    const content = await readFile(join(turnsDir, file), 'utf8');
    turns.push(content);
  }

  // Assemble
  const parts = [
    rolePrompt(topic),
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
