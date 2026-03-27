import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getPhaseToken } from "@/lib/phase-tokens"
import { getAgentToken } from "@/lib/agent-tokens"
import { CheckCircle2, ListChecks, Radio } from "lucide-react"
import type { Turn, ThinkingState, SessionPhase, SessionStatus } from "@/lib/types"

interface CurrentStateBarProps {
  phase: SessionPhase
  thinking: ThinkingState | null
  thinkingElapsed: string
  sessionStatus: SessionStatus
  statusText: string
  turns: Turn[]
}

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  paused: "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400",
  completed: "border-border bg-muted text-muted-foreground",
  interrupted: "border-red-500/40 bg-red-500/15 text-red-600 dark:text-red-400",
}

const DOT_COLORS: Record<string, string> = {
  active: "text-emerald-600 dark:text-emerald-400",
  paused: "text-amber-600 dark:text-amber-400",
  completed: "text-muted-foreground",
  interrupted: "text-red-600 dark:text-red-400",
}

const STATUS_DESCRIPTION: Record<string, string> = {
  active: "Session is running \u2014 agents are working",
  paused: "Session paused \u2014 human input needed",
  completed: "Session finished \u2014 all phases complete",
  interrupted: "Session was stopped before completion",
}

export function CurrentStateBar({
  phase,
  thinking,
  thinkingElapsed,
  sessionStatus,
  statusText,
  turns,
}: CurrentStateBarProps) {
  const phaseToken = getPhaseToken(phase)

  const lastDecision = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i]
      if (t.decisions?.length) {
        return t.decisions[t.decisions.length - 1]
      }
    }
    return null
  }, [turns])

  const truncatedDecision = useMemo(() => {
    if (!lastDecision) return null
    return lastDecision.length > 60
      ? lastDecision.slice(0, 57) + "..."
      : lastDecision
  }, [lastDecision])

  // Show nothing when loading or interrupted
  if (sessionStatus !== "active" && sessionStatus !== "paused" && sessionStatus !== "completed") {
    return null
  }

  // Completed state
  if (sessionStatus === "completed") {
    return (
      <div
        data-testid="current-state-bar"
        className="flex items-center gap-2 border-b border-border/20 bg-muted/30 px-5 py-1"
      >
        <CheckCircle2 className="h-3 w-3 text-muted-foreground/60" />
        <span className="text-[11px] text-muted-foreground/60">
          Session completed
        </span>
      </div>
    )
  }

  const agentToken = thinking ? getAgentToken(thinking.agent) : null

  return (
    <div
      data-testid="current-state-bar"
      className="flex items-center gap-2.5 border-b border-border/20 bg-muted/30 px-5 py-1"
    >
      {/* Status badge */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            className={cn(
              "gap-1.5 px-2 py-0 text-[10px] font-medium",
              STATUS_BADGE[sessionStatus]
            )}
          >
            <Radio
              className={cn(
                "h-2.5 w-2.5",
                DOT_COLORS[sessionStatus],
                sessionStatus === "active" && "animate-pulse status-active-indicator"
              )}
            />
            {statusText}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{STATUS_DESCRIPTION[sessionStatus] ?? statusText}</TooltipContent>
      </Tooltip>

      {/* Phase badge */}
      <Badge
        variant="outline"
        className={cn(
          "px-1.5 py-0 font-mono text-[10px] font-semibold tracking-wider",
          phaseToken.badgeClass,
        )}
      >
        {phaseToken.shortLabel}
      </Badge>

      {/* Agent thinking indicator */}
      {thinking && agentToken && (
        <div className="flex items-center gap-1.5">
          <Spinner
            className={cn("h-2.5 w-2.5", agentToken.spinnerClass)}
          />
          <Badge
            variant="outline"
            className={cn(
              "px-1.5 py-0 font-mono text-[10px] font-semibold tracking-wider",
              agentToken.badgeClass,
            )}
          >
            {agentToken.label}
          </Badge>
          {thinkingElapsed && (
            <span className="font-mono text-[10px] text-muted-foreground/50">
              {thinkingElapsed}
            </span>
          )}
        </div>
      )}

      {/* Last decision — hidden on narrow viewports */}
      {truncatedDecision && (
        <div className="hidden min-w-0 items-center gap-1 sm:flex">
          <span className="text-muted-foreground/30">|</span>
          <ListChecks className="h-3 w-3 shrink-0 text-muted-foreground/40" />
          <span className="truncate text-[11px] text-muted-foreground/60">
            {truncatedDecision}
          </span>
        </div>
      )}
    </div>
  )
}
