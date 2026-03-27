import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { ChevronsDownUp, ChevronsUpDown, Clock, DollarSign, Hash } from "lucide-react"

interface StatusBarProps {
  turnCount: number
  sessionTimer: string
  allCollapsed: boolean
  onToggleAll: () => void
  costUsd?: number | null
}

function formatCost(usd: number): string {
  if (usd < 0.01) return "<$0.01"
  return `$${usd.toFixed(2)}`
}

export function StatusBar({ turnCount, sessionTimer, allCollapsed, onToggleAll, costUsd }: StatusBarProps) {
  return (
    <div data-testid="status-bar" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/30 bg-card/80 px-5 py-2.5">
      <div className="flex items-center gap-1.5 text-sm text-foreground/70">
        <Hash className="h-3.5 w-3.5 text-muted-foreground/60" />
        <span className="font-mono font-medium">{turnCount}</span>
        <span className="text-muted-foreground/50">turns</span>
      </div>

      <Separator orientation="vertical" className="hidden h-4 sm:block" />

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
