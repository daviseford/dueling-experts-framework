import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { listTurnFiles } from './session.js';
import { validate } from './validation.js';

const AGENT_NAMES = { claude: 'Claude', codex: 'Codex' };

// Budget: ~100K tokens × 4 chars/token = 400K chars.
// Reserve headroom for the model's response.
const CHAR_BUDGET = 400_000;

function debatePrompt(agent, topic) {
  const other = agent === 'claude' ? 'Codex' : 'Claude';
  return `You are ${AGENT_NAMES[agent]}, participating in a structured planning conversation with another AI agent (${other}).
You are collaborating on: ${topic}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "${agent}"), timestamp (ISO-8601), status (complete | needs_human | done | decided).
- Optional frontmatter: decisions (array of strings — key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree — push for better solutions.
- If you need human input to proceed, set status: needs_human and explain what you need in the body.
- If the plan is complete and BOTH agents have contributed, set status: done. Do NOT set done on your first turn — the other agent must have a chance to respond.
- If you believe you and the other agent have reached consensus on all key decisions, set status: decided. The other agent will then confirm or contest.
- Always use status: complete unless the conversation is truly finished after multiple turns.
- Do NOT include anything before the opening --- of the frontmatter.`;
}

function implementPrompt(agent, topic, decisions) {
  const decisionsList = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(No decisions recorded — implement based on the debate context above.)';

  return `You are ${AGENT_NAMES[agent]}, implementing the decisions from a debate on: ${topic}

## Debate Decisions
${decisionsList}

## Your Task
Implement the decisions above by producing structured action blocks. Each action must be wrapped in a fenced code block with the \`def-action\` info string.

## Action Format

### Write a file
\`\`\`def-action
type: write-file
path: relative/path/to/file.js
---
file content here
\`\`\`

### Edit a file (search and replace)
\`\`\`def-action
type: edit-file
path: relative/path/to/file.js
search: exact string to find
---
replacement string
\`\`\`

### Run a shell command
\`\`\`def-action
type: shell
cmd: npm test
cwd: .
\`\`\`

### Create a directory
\`\`\`def-action
type: mkdir
path: relative/path/to/dir
\`\`\`

## Rules
- Respond with YAML frontmatter followed by markdown containing your action blocks.
- Required frontmatter fields: id, turn, from (must be "${agent}"), timestamp (ISO-8601), status.
- Set status: complete when your implementation is done.
- Explain what each action does in markdown before the action block.
- All paths are relative to the project root.
- Do NOT include anything before the opening --- of the frontmatter.`;
}

function reviewPrompt(agent, topic, decisions, actionResults) {
  const other = agent === 'claude' ? 'Codex' : 'Claude';
  const decisionsList = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(No decisions recorded.)';

  let resultsText = '';
  if (actionResults && actionResults.length > 0) {
    resultsText = actionResults.map((r, i) => {
      const status = r.ok ? 'OK' : `FAILED: ${r.error}`;
      const desc = r.action.type === 'shell'
        ? `shell: ${r.action.cmd}`
        : `${r.action.type}: ${r.action.path || ''}`;
      return `${i + 1}. [${status}] ${desc}`;
    }).join('\n');
  } else {
    resultsText = '(No action results available.)';
  }

  return `You are ${AGENT_NAMES[agent]}, reviewing an implementation by ${other} for: ${topic}

## Debate Decisions
${decisionsList}

## Implementation Actions & Results
${resultsText}

## Your Task
Review the implementation against the debate decisions. Check:
1. Were all decisions faithfully implemented?
2. Are there any bugs, errors, or missing pieces?
3. Did any actions fail that need to be fixed?

## Rules
- Respond with YAML frontmatter followed by your review.
- Required frontmatter fields: id, turn, from (must be "${agent}"), timestamp (ISO-8601), status.
- If the implementation is correct and complete, set status: done.
- If fixes are needed, set status: complete and describe what needs to change. The implementing agent will get another turn.
- Be specific about what's wrong and how to fix it.
- Do NOT include anything before the opening --- of the frontmatter.`;
}

/**
 * Assemble the full prompt for an agent invocation.
 * Uses a character budget to prevent exceeding model context windows.
 * Oldest turns are dropped first; their decisions are preserved in a summary.
 */
export async function assemble(session) {
  const { topic, mode, next_agent, dir, phase } = session;

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

  // Collect all decisions from all turns
  const allDecisions = turnContents.flatMap(t => t.decisions);

  // Load action results for review phase
  let actionResults = null;
  if ((phase || 'debate') === 'review') {
    actionResults = await loadActionResults(dir);
  }

  // Build fixed parts based on phase
  const currentPhase = phase || 'debate';
  let systemPrompt;
  if (currentPhase === 'implement') {
    systemPrompt = implementPrompt(next_agent, topic, allDecisions);
  } else if (currentPhase === 'review') {
    systemPrompt = reviewPrompt(next_agent, topic, allDecisions, actionResults);
  } else {
    systemPrompt = debatePrompt(next_agent, topic);
  }

  const sessionBrief = `## Session Brief\n**Topic:** ${topic}\n**Mode:** ${mode}\n**Phase:** ${currentPhase}\n`;
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
 * Load action results from the artifacts directory.
 */
async function loadActionResults(sessionDir) {
  const { readdir } = await import('node:fs/promises');
  const artifactsDir = join(sessionDir, 'artifacts');
  let files;
  try {
    files = await readdir(artifactsDir);
  } catch {
    return null;
  }

  const resultFiles = files
    .filter(f => f.startsWith('action-results-') && f.endsWith('.json'))
    .sort();

  if (resultFiles.length === 0) return null;

  // Return the most recent action results
  const latest = resultFiles[resultFiles.length - 1];
  const raw = await readFile(join(artifactsDir, latest), 'utf8');
  return JSON.parse(raw);
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
