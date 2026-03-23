import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Activity, Clock, Hash } from "lucide-react"

interface StatusBarProps {
  statusText: string
  turnCount: number
  sessionStatus: "active" | "paused" | "completed"
  sessionTimer: string
}

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  paused: "text-amber-400",
  completed: "text-muted-foreground",
}

const DOT_COLORS: Record<string, string> = {
  active: "bg-emerald-400",
  paused: "bg-amber-400",
  completed: "bg-muted-foreground",
}

export function StatusBar({ statusText, turnCount, sessionStatus, sessionTimer }: StatusBarProps) {
  return (
    <div className="flex h-7 items-center gap-2.5 border-t border-border/50 bg-card/80 px-4 font-mono text-[11px] text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "inline-block h-1.5 w-1.5 rounded-full",
            DOT_COLORS[sessionStatus],
            sessionStatus === "active" && "animate-pulse"
          )}
        />
        <span className={cn(STATUS_COLORS[sessionStatus])}>
          {statusText}
        </span>
      </div>
      <Separator orientation="vertical" className="h-3" />
      <div className="flex items-center gap-1">
        <Hash className="h-3 w-3 text-muted-foreground/50" />
        <span>{turnCount}</span>
      </div>
      <Separator orientation="vertical" className="h-3" />
      <div className="flex items-center gap-1">
        <Clock className="h-3 w-3 text-muted-foreground/50" />
        <span>{sessionTimer}</span>
      </div>
      <span className="flex-1" />
      <Activity className="h-3 w-3 text-muted-foreground/30" />
    </div>
  )
}
