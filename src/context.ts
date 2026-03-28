import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { listTurnFiles } from './session.js';
import { validate } from './validation.js';
import type { Session, SessionPhase } from './session.js';
import type { Participant } from './roster.js';
import { getProvider } from './agent.js';

// ── Type definitions ────────────────────────────────────────────────

/** Maximum characters of diff to include in review prompt before truncating. */
const MAX_DIFF_CHARS = 50_000;

/** A turn's content plus metadata extracted during prompt assembly. */
interface TurnContent {
  raw: string;
  turn: number | undefined;
  from: string | undefined;
  decisions: string[];
}

// ── Constants ───────────────────────────────────────────────────────

/** Shared rule appended to all prompt templates to prevent encoding issues. */
const ASCII_RULE = 'Use ASCII-safe punctuation only. Use - or -- instead of em-dashes or en-dashes. Do not use Unicode special characters.';

/** Shared rule warning agents that .def/ and gitignored paths are ephemeral, not authoritative. */
const ARTIFACT_AUTHORITY_RULE = 'Paths under `.def/` (sessions, worktrees, artifacts) and gitignored `docs/` directories are ephemeral session artifacts -- not authoritative project source. The canonical codebase is the tracked files in the working directory. When referencing code, use repo-relative paths, not absolute `.def/worktrees/...` paths.';

// Budget: ~100K tokens x 4 chars/token = 400K chars.
// Must stay within Haiku's 200K-token context window when fast-tier is active.
// Code-heavy content may compress to ~3 chars/token (~133K tokens). Reserve headroom
// for the model's response.
const CHAR_BUDGET = 400_000;

// ── Participant resolution ──────────────────────────────────────────

/**
 * Resolve the current participant and the "other" participant from the session.
 * Uses the roster if present, falls back to provider registry for display names.
 */
function resolveParticipants(session: Session): { self: Participant; other: Participant } {
  const roster = session.roster;
  if (roster && roster.length >= 2) {
    const self = roster.find(p => p.id === session.next_agent);
    if (!self) throw new Error(`Participant "${session.next_agent}" not found in roster`);
    const other = roster.find(p => p.id !== session.next_agent);
    if (!other) throw new Error('No other participant found in roster');
    return { self, other };
  }
  // Fallback for sessions without a valid roster
  const provider = getProvider(session.next_agent);
  if (!provider) throw new Error(`Unknown agent: "${session.next_agent}". No matching provider or roster entry found.`);
  const selfParticipant: Participant = {
    id: session.next_agent,
    provider: session.next_agent,
    role: 'planner',
    displayName: provider.displayName,
  };
  const otherParticipant: Participant = {
    id: 'unknown',
    provider: 'unknown',
    role: 'reviewer',
    displayName: 'Other Agent',
  };
  return { self: selfParticipant, other: otherParticipant };
}

// ── Prompt templates ────────────────────────────────────────────────

function planPrompt(self: Participant, other: Participant, topic: string): string {
  const personaLine = self.persona ? `\n\nYour persona: ${self.persona}\n` : '';
  return `You are ${self.displayName}, participating in a structured planning conversation with another AI agent (${other.displayName}).${personaLine}
You are collaborating on: ${topic}

## Rules
- Respond with YAML frontmatter followed by markdown. Required frontmatter fields: id, turn, from (must be "${self.id}"), timestamp (ISO-8601), status (complete | needs_human | done | decided).
- Optional frontmatter: decisions (array of strings -- key decisions made in this turn).
- Be specific and concrete. Reference files, functions, and line numbers in the target repo when relevant.
- Challenge the other agent's assumptions. Don't just agree -- push for better solutions.
- You have read-only tool access (Read, Glob, Grep, git). You CANNOT modify files -- that happens in the implementation phase. Do not request human help because of this limitation. When the plan is ready to implement, set status: decided.
- If the plan is complete and BOTH agents have contributed, set status: done. Do NOT set done on your first turn -- the other agent must have a chance to respond.
- If you believe you and the other agent have reached consensus on all key decisions, set status: decided. The other agent will then confirm or contest.
- Always use status: complete unless the conversation is truly finished after multiple turns.
- Do NOT include anything before the opening --- of the frontmatter.
- ${ASCII_RULE}
- ${ARTIFACT_AUTHORITY_RULE}`;
}

function implementPrompt(self: Participant, topic: string, decisions: string[]): string {
  const decisionsList = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(No decisions recorded -- implement based on the debate context above.)';

  return `You are ${self.displayName}, implementing the decisions from a debate on: ${topic}

## Debate Decisions
${decisionsList}

## Your Task
Implement the decisions above. You have full tool access -- you can read, write, and edit files, and run shell commands directly. The working directory is the project root.

Make the changes directly. Do not describe what you would do -- actually do it.

## Rules
- Respond with YAML frontmatter followed by a brief markdown summary of what you implemented.
- Required frontmatter fields: id, turn, from (must be "${self.id}"), timestamp (ISO-8601), status.
- Set status: complete when your implementation is done.
- Summarize the changes you made (files created/modified, commands run).
- Do NOT include anything before the opening --- of the frontmatter.
- ${ASCII_RULE}
- ${ARTIFACT_AUTHORITY_RULE}`;
}

function reviewPrompt(self: Participant, other: Participant, topic: string, decisions: string[], diff: string | null): string {
  const decisionsList = decisions.length > 0
    ? decisions.map((d, i) => `${i + 1}. ${d}`).join('\n')
    : '(No decisions recorded.)';

  let diffText: string;
  if (!diff) {
    diffText = '(No changes were made.)';
  } else {
    // Sanitize: escape triple backticks in diff content to prevent code fence escape
    const safeDiff = diff.replace(/```/g, '` ` `');
    if (safeDiff.length > MAX_DIFF_CHARS) {
      const truncated = safeDiff.slice(0, MAX_DIFF_CHARS);
      diffText = `\`\`\`diff\n${truncated}\n\`\`\`\n\n*[Diff truncated at ${MAX_DIFF_CHARS} characters]*`;
    } else {
      diffText = '```diff\n' + safeDiff + '\n```';
    }
  }

  return `You are ${self.displayName}, reviewing an implementation by ${other.displayName} for: ${topic}

## Debate Decisions
${decisionsList}

## Implementation Diff
${diffText}

## Your Task
Review the implementation diff against the debate decisions. Check:
1. Were all decisions faithfully implemented?
2. Are there any bugs, errors, or missing pieces?
3. Does the code follow project conventions?

## Rules
- Respond with YAML frontmatter followed by your review.
- Required frontmatter fields: id, turn, from (must be "${self.id}"), timestamp (ISO-8601), status.
- If the implementation is correct and complete, set status: decided and verdict: approve.
- If fixes are needed, set status: decided and verdict: fix, then describe what needs to change. The implementing agent will get another turn.
- The verdict field is REQUIRED when status is decided. Must be either "approve" or "fix".
- Be specific about what's wrong and how to fix it.
- Do NOT include anything before the opening --- of the frontmatter.
- ${ASCII_RULE}
- ${ARTIFACT_AUTHORITY_RULE}`;
}

// ── Main assembly ───────────────────────────────────────────────────

/**
 * Assemble the full prompt for an agent invocation.
 * Uses a character budget to prevent exceeding model context windows.
 * Oldest turns are dropped first; their decisions are preserved in a summary.
 */
export async function assemble(session: Session): Promise<string> {
  const { topic, mode, dir, phase } = session;

  if (mode !== 'planning' && mode !== 'edit') {
    throw new Error(`Unknown mode: "${mode}". Supported: edit, planning`);
  }

  // Resolve participants from roster
  const { self, other } = resolveParticipants(session);

  // Read all existing turns
  const turnsDir = join(dir, 'turns');
  const turnFiles = await listTurnFiles(turnsDir);

  const turnContents: TurnContent[] = await Promise.all(
    turnFiles.map(async (file): Promise<TurnContent> => {
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

  // Load diff for review phase
  let diff: string | null = null;
  if (phase === 'review') {
    diff = await loadDiff(dir);
  }

  // Build fixed parts based on phase
  let systemPrompt: string;
  if (phase === 'implement') {
    systemPrompt = implementPrompt(self, topic, allDecisions);
  } else if (phase === 'review') {
    systemPrompt = reviewPrompt(self, other, topic, allDecisions, diff);
  } else {
    systemPrompt = planPrompt(self, other, topic);
  }

  const sessionBrief = `## Session Brief\n**Topic:** ${topic}\n**Mode:** ${mode}\n**Phase:** ${phase}\n`;
  const yourTurn = '## Your Turn\nRespond with YAML frontmatter followed by your markdown response. Required frontmatter fields: id, turn, from, timestamp, status. Optional: decisions (array of strings).';

  const fixedChars = systemPrompt.length + sessionBrief.length + yourTurn.length + 20; // newlines
  let remaining = CHAR_BUDGET - fixedChars;

  // Include turns newest-first until budget is exhausted
  const included: TurnContent[] = [];
  const truncated: TurnContent[] = [];

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
 * Load the most recent diff artifact from the session's artifacts directory.
 */
async function loadDiff(sessionDir: string): Promise<string | null> {
  const artifactsDir = join(sessionDir, 'artifacts');
  let files: string[];
  try {
    files = await readdir(artifactsDir);
  } catch {
    return null;
  }

  const diffFiles = files
    .filter(f => f.startsWith('diff-') && f.endsWith('.patch'))
    .sort();

  if (diffFiles.length === 0) return null;

  const latest = diffFiles[diffFiles.length - 1];
  return readFile(join(artifactsDir, latest), 'utf8');
}

/**
 * Build a summary notice for turns that were truncated due to context budget.
 */
function buildTruncationNotice(truncated: TurnContent[], decisions: string[]): string {
  const first = truncated[0].turn ?? '?';
  const last = truncated[truncated.length - 1].turn ?? '?';
  const lines = [
    `> **[Context truncated]** Turns ${first}-${last} omitted (${truncated.length} turn(s), ${decisions.length} decision(s) preserved).`,
  ];

  if (decisions.length > 0) {
    lines.push('> **Decisions from truncated turns:**');
    for (const d of decisions) {
      lines.push(`> - ${d}`);
    }
  }

  return lines.join('\n');
}
