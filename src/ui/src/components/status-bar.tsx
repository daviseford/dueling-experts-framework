import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface StatusBarProps {
  statusText: string
  turnCount: number
  sessionStatus: "active" | "paused" | "completed"
  sessionTimer: string
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  active: "bg-green-900/50 text-green-300 border-green-700/50",
  paused: "bg-amber-900/50 text-amber-300 border-amber-700/50",
  completed: "bg-muted text-muted-foreground border-border",
}

export function StatusBar({ statusText, turnCount, sessionStatus, sessionTimer }: StatusBarProps) {
  return (
    <div className="flex h-7 items-center gap-3 border-t border-border bg-card px-5 text-xs text-muted-foreground">
      <Badge
        variant="outline"
        className={cn(
          "h-4 rounded-sm px-1.5 text-[10px] font-medium",
          STATUS_BADGE_STYLES[sessionStatus]
        )}
      >
        {statusText}
      </Badge>
      <Separator orientation="vertical" className="h-3.5" />
      <span className="font-mono">Turn {turnCount}</span>
      <Separator orientation="vertical" className="h-3.5" />
      <span className="font-mono">{sessionTimer}</span>
      <div className="flex-1" />
      <span className="font-mono">{turnCount} total turns</span>
    </div>
  )
}
