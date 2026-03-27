import type { SessionPhase } from "@/lib/types"

/**
 * Centralized phase display metadata.
 * Single source of truth for phase colors, labels, and styles across all UI components.
 */

export interface PhaseToken {
  /** Human-readable label */
  label: string
  /** Short label for tight spaces (tab bar, etc.) */
  shortLabel: string
  /** Badge class for turn cards and similar badge-style usage */
  badgeClass: string
  /** Text-only class for tab bar and inline text */
  textClass: string
  /** Thinking indicator label (gerund form) */
  thinkingLabel: string
}

export const PHASE_TOKENS: Record<SessionPhase, PhaseToken> = {
  plan: {
    label: "Plan",
    shortLabel: "PLAN",
    badgeClass: "bg-orange-500/10 text-orange-600/70 dark:text-orange-400/70 border-orange-500/20",
    textClass: "text-orange-600/70 dark:text-orange-400/70",
    thinkingLabel: "Planning",
  },
  debate: {
    label: "Debate",
    shortLabel: "DEBATE",
    badgeClass: "bg-lime-500/10 text-lime-600/70 dark:text-lime-400/70 border-lime-500/20",
    textClass: "text-lime-600/70 dark:text-lime-400/70",
    thinkingLabel: "Debating",
  },
  implement: {
    label: "Implement",
    shortLabel: "IMPL",
    badgeClass: "bg-cyan-500/10 text-cyan-600/70 dark:text-cyan-400/70 border-cyan-500/20",
    textClass: "text-cyan-600/70 dark:text-cyan-400/70",
    thinkingLabel: "Implementing",
  },
  review: {
    label: "Review",
    shortLabel: "REVIEW",
    badgeClass: "bg-pink-500/10 text-pink-600/70 dark:text-pink-400/70 border-pink-500/20",
    textClass: "text-pink-600/70 dark:text-pink-400/70",
    thinkingLabel: "Reviewing",
  },
}

/** Human-readable phase descriptions for tooltips */
export const PHASE_DESCRIPTIONS: Record<SessionPhase, string> = {
  plan: "Agents are proposing and debating approaches",
  debate: "Agents are refining the plan through discussion",
  implement: "Agent is writing code changes in the worktree",
  review: "Agent is reviewing the implementation for issues",
}

/** Get phase token with fallback for unknown phases */
export function getPhaseToken(phase: string): PhaseToken {
  return PHASE_TOKENS[phase as SessionPhase] ?? {
    label: phase,
    shortLabel: phase.toUpperCase(),
    badgeClass: "bg-muted text-muted-foreground",
    textClass: "text-muted-foreground/60",
    thinkingLabel: "Thinking",
  }
}
