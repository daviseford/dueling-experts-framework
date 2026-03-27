import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { ChevronsDownUp, ChevronsUpDown, Clock, DollarSign, Hash, Radio } from "lucide-react"

interface StatusBarProps {
  statusText: string
  turnCount: number
  sessionStatus: "active" | "paused" | "completed" | "interrupted"
  sessionTimer: string
  allCollapsed: boolean
  onToggleAll: () => void
  costUsd?: number | null
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

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(2)}`
}

export function StatusBar({ statusText, turnCount, sessionStatus, sessionTimer, allCollapsed, onToggleAll, costUsd }: StatusBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/30 bg-card/80 px-5 py-2.5">
      {/* Primary row: status badge always first */}
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

      <Separator orientation="vertical" className="hidden h-4 sm:block" />

      <div className="flex items-center gap-1.5 text-sm text-foreground/70">
        <Hash className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono font-medium">{turnCount}</span>
        <span className="text-muted-foreground/50">turns</span>
      </div>

      <Separator orientation="vertical" className="hidden h-4 sm:block" />

      {/* Timer and cost wrap on narrow screens instead of being hidden */}
      <div className="flex items-center gap-1.5 text-sm text-foreground/70">
        <Clock className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono font-medium">{sessionTimer}</span>
      </div>

      {costUsd != null && costUsd > 0 && (
        <>
          <Separator orientation="vertical" className="hidden h-4 sm:block" />
          <div className="flex items-center gap-1.5 text-sm text-foreground/70">
            <DollarSign className="h-3.5 w-3.5 text-muted-foreground/60" />
            <span className="font-mono font-medium">{formatCost(costUsd)}</span>
          </div>
        </>
      )}

      {/* Toggle stays right-aligned on the first row */}
      <span className="flex-1" />

      {turnCount > 1 && (
        <Button
          variant="ghost"
          size="sm"
          className="order-last h-6 gap-1 px-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
          onClick={onToggleAll}
        >
          {allCollapsed ? (
            <>
              <ChevronsUpDown className="h-3 w-3" />
              Expand all
            </>
          ) : (
            <>
              <ChevronsDownUp className="h-3 w-3" />
              Collapse all
            </>
          )}
        </Button>
      )}

    </div>
  )
}
