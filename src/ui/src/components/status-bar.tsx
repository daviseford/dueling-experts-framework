import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { Clock, Hash, Radio } from "lucide-react"

interface StatusBarProps {
  statusText: string
  turnCount: number
  sessionStatus: "active" | "paused" | "completed" | "interrupted"
  sessionTimer: string
}

const STATUS_BADGE: Record<string, string> = {
  active: "border-emerald-500/40 bg-emerald-500/15 text-emerald-400",
  paused: "border-amber-500/40 bg-amber-500/15 text-amber-400",
  completed: "border-border bg-muted text-muted-foreground",
}

const DOT_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  paused: "text-amber-400",
  completed: "text-muted-foreground",
}

export function StatusBar({ statusText, turnCount, sessionStatus, sessionTimer }: StatusBarProps) {
  return (
    <div className="flex items-center gap-3 border-t border-border/50 bg-card/80 px-5 py-2">
      <Badge
        variant="outline"
        className={cn(
          "gap-1.5 px-2.5 py-0.5 text-xs font-medium",
          STATUS_BADGE[sessionStatus]
        )}
      >
        <Radio
          className={cn(
            "h-3 w-3",
            DOT_COLORS[sessionStatus],
            sessionStatus === "active" && "animate-pulse"
          )}
        />
        {statusText}
      </Badge>

      <Separator orientation="vertical" className="h-4" />

      <div className="flex items-center gap-1.5 text-sm text-foreground/70">
        <Hash className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono font-medium">{turnCount}</span>
        <span className="text-muted-foreground/50">turns</span>
      </div>

      <Separator orientation="vertical" className="h-4" />

      <div className="flex items-center gap-1.5 text-sm text-foreground/70">
        <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono font-medium">{sessionTimer}</span>
      </div>
    </div>
  )
}
