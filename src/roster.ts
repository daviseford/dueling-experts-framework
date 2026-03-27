// ── Participant type and roster utilities ──────────────────────────

import { listProviders } from './agent.js';

/**
 * A logical participant in a DEF session.
 * Binds a unique identity (id, displayName, role, persona) to a physical
 * provider (CLI backend) from the agent registry.
 */
export interface Participant {
  /** Unique logical ID within this session (e.g., 'claude', 'codex', 'claude-0'). */
  id: string;

  /** Provider name from the agent registry (e.g., 'claude', 'codex'). */
  provider: string;

  /** Role in the session -- determines dispatch in implement/review phases. */
  role: 'planner' | 'implementer' | 'reviewer';

  /** Optional persona prompt injected into system messages. */
  persona?: string;

  /** Display name for UI and prompts (e.g., 'Claude', 'Codex', 'Claude (Alpha)'). */
  displayName: string;
}

/**
 * Build a session roster from a list of agent provider names.
 * Handles self-debate (duplicate providers) by generating unique IDs and personas.
 */
export function buildRoster(agents: string[], implModel: string, displayNames?: Record<string, string>): Participant[] {
  const hasDuplicates = new Set(agents).size < agents.length;

  return agents.map((agent, i) => {
    const id = hasDuplicates ? `${agent}-${i}` : agent;
    const implId = hasDuplicates ? `${implModel}-0` : implModel;
    const isImpl = id === implId;

    const baseName = displayNames?.[agent] ?? capitalize(agent);
    const displayName = hasDuplicates
      ? `${baseName} (${i === 0 ? 'Alpha' : 'Beta'})`
      : baseName;

    const persona = hasDuplicates
      ? (i === 0
        ? 'You are the first debater. Push for bold, creative solutions.'
        : 'You are the second debater. Challenge assumptions and find flaws.')
      : undefined;

    return {
      id,
      provider: agent,
      role: isImpl ? 'implementer' as const : 'reviewer' as const,
      displayName,
      persona,
    };
  });
}

/**
 * Build a default two-agent roster for backward compatibility.
 * Called when no --agents flag is provided.
 * Derives the second agent from the provider registry -- the first registered
 * provider that is not the firstAgent. Falls back to firstAgent (self-debate)
 * if only one provider is registered.
 */
export function buildDefaultRoster(firstAgent: string, implModel: string, displayNames?: Record<string, string>): Participant[] {
  const agents = [firstAgent];
  const registered = listProviders();
  const otherAgent = registered.find(a => a !== firstAgent) ?? firstAgent;
  agents.push(otherAgent);

  return buildRoster(agents, implModel, displayNames);
}

// ── Roster query helpers ──────────────────────────────────────────

/** Get the implementing participant from the roster. */
export function getImplementer(roster: Participant[]): Participant {
  return roster.find(p => p.role === 'implementer') ?? roster[0];
}

/** Get the reviewing participant from the roster. */
export function getReviewer(roster: Participant[]): Participant {
  return roster.find(p => p.role === 'reviewer') ?? roster[1] ?? roster[0];
}

/** Get the other participant (for two-agent sessions). */
export function getOtherParticipant(roster: Participant[], currentId: string): Participant {
  return roster.find(p => p.id !== currentId) ?? roster[0];
}

/** Look up a participant by ID. Throws if not found. */
export function getParticipant(roster: Participant[], id: string): Participant {
  const p = roster.find(p => p.id === id);
  if (!p) throw new Error(`Participant "${id}" not found in roster`);
  return p;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
