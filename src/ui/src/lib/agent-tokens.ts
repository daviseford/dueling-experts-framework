export interface AgentToken {
  label: string
  borderClass: string
  badgeClass: string
  spinnerClass: string
  scanGradient: string
}

const TOKENS: Record<string, AgentToken> = {
  claude: {
    label: "CLAUDE",
    borderClass: "border-l-blue-500",
    badgeClass: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
    spinnerClass: "text-blue-600 dark:text-blue-400",
    scanGradient: "from-transparent via-blue-500/8 to-transparent",
  },
  codex: {
    label: "CODEX",
    borderClass: "border-l-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    spinnerClass: "text-emerald-600 dark:text-emerald-400",
    scanGradient: "from-transparent via-emerald-500/8 to-transparent",
  },
  human: {
    label: "USER",
    borderClass: "border-l-violet-400",
    badgeClass: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25",
    spinnerClass: "text-violet-600 dark:text-violet-400",
    scanGradient: "from-transparent via-violet-500/8 to-transparent",
  },
  system: {
    label: "SYSTEM",
    borderClass: "border-l-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    spinnerClass: "text-amber-600 dark:text-amber-400",
    scanGradient: "from-transparent via-amber-500/8 to-transparent",
  },
}

const FALLBACK: AgentToken = {
  label: "AGENT",
  borderClass: "border-l-muted-foreground",
  badgeClass: "bg-muted/50 text-muted-foreground border-border/50",
  spinnerClass: "text-muted-foreground",
  scanGradient: "from-transparent via-muted-foreground/8 to-transparent",
}

export function getAgentToken(agent: string): AgentToken {
  return TOKENS[agent] ?? { ...FALLBACK, label: agent.toUpperCase() }
}
