import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { getPhaseToken } from "@/lib/phase-tokens"
import { getAgentToken } from "@/lib/agent-tokens"
import type { ThinkingState, SessionPhase } from "@/lib/types"

interface ThinkingIndicatorProps {
  thinking: ThinkingState
  elapsed: string
  phase: SessionPhase
}

export function ThinkingIndicator({ thinking, elapsed, phase }: ThinkingIndicatorProps) {
  const token = getAgentToken(thinking.agent)

  return (
    <div
      data-testid="thinking-indicator"
      role="status"
      aria-live="polite"
      aria-label={`${token.label} is ${getPhaseToken(phase).thinkingLabel.toLowerCase()}`}
      className={cn(
        "relative overflow-hidden rounded-lg border-l-[3px] bg-card/60 ring-1 ring-border/10",
        token.borderClass
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute inset-0 animate-scan bg-gradient-to-r",
          token.scanGradient
        )}
      />
      <div className="relative flex items-center gap-2.5 px-4 py-3">
        <Spinner
          className={cn("h-3.5 w-3.5", token.spinnerClass)}
        />
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[10px] font-semibold tracking-wider",
            token.badgeClass
          )}
        >
          {token.label}
        </Badge>
        <span className="thinking-glow text-[13px] text-muted-foreground">
          {getPhaseToken(phase).thinkingLabel}
        </span>
        {thinking.model && (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            {thinking.model}
          </span>
        )}
        <span className="font-mono text-[11px] text-muted-foreground/60">
          {elapsed}
        </span>
      </div>
    </div>
  )
}
