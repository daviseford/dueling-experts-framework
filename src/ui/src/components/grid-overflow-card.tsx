import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getPhaseToken } from "@/lib/phase-tokens"
import { Maximize2, X, Radio, Hash, Clock } from "lucide-react"
import type { SessionSummary } from "@/lib/types"

interface GridOverflowCardProps {
  session: SessionSummary
  onMaximize: () => void
  onDismiss: () => void
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

function formatElapsed(created: string): string {
  const ms = Date.now() - new Date(created).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function GridOverflowCard({ session, onMaximize, onDismiss }: GridOverflowCardProps) {
  const phaseToken = getPhaseToken(session.phase)
  const status = session.session_status
  const canDismiss = status === "completed" || status === "interrupted"

  return (
    <div
      className="flex min-h-0 min-w-0 flex-col justify-between overflow-hidden rounded-lg border border-border/60 shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/60 bg-muted/50 px-3 py-1.5">
        <h2 className="flex-1 truncate text-xs font-medium text-foreground/80">
          {session.topic || "Untitled session"}
        </h2>
        {canDismiss && (
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-foreground" onClick={onDismiss} title="Dismiss">
            <span className="sr-only">Dismiss session</span>
            <X className="h-3 w-3" />
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-foreground" onClick={onMaximize} title="Maximize">
          <Maximize2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Body */}
      <div className="flex flex-1 items-center gap-3 px-4 py-3">
        {/* Status */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              variant="outline"
              className={cn(
                "gap-1.5 px-2 py-0 text-[10px] font-medium",
                STATUS_BADGE[status],
              )}
            >
              <Radio
                className={cn(
                  "h-2.5 w-2.5",
                  DOT_COLORS[status],
                  status === "active" && "animate-pulse status-active-indicator",
                )}
              />
              {status.charAt(0).toUpperCase() + status.slice(1)}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>Click maximize to view full session</TooltipContent>
        </Tooltip>

        {/* Phase */}
        <Badge
          variant="outline"
          className={cn(
            "px-1.5 py-0 font-mono text-[10px] font-semibold tracking-wider",
            phaseToken.badgeClass,
          )}
        >
          {phaseToken.shortLabel}
        </Badge>

        {/* Turn count */}
        <div className="flex items-center gap-1 text-muted-foreground/60">
          <Hash className="h-3 w-3" />
          <span className="text-[11px]">{session.current_turn} turns</span>
        </div>

        {/* Elapsed */}
        <div className="flex items-center gap-1 text-muted-foreground/60">
          <Clock className="h-3 w-3" />
          <span className="text-[11px]">{formatElapsed(session.created)}</span>
        </div>
      </div>
    </div>
  )
}
