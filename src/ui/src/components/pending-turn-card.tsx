import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import { getAgentToken } from "@/lib/agent-tokens"

interface PendingTurnCardProps {
  content: string
}

export function PendingTurnCard({ content }: PendingTurnCardProps) {
  const token = getAgentToken("human")

  return (
    <div className={cn(
      "animate-fade-in overflow-hidden rounded-lg border-l-[3px] border-dashed bg-card/60 opacity-90 ring-1 ring-border/10",
      token.borderClass
    )}>
      <div className="flex items-center gap-2 px-3 py-2">
        <Spinner className={cn("h-3 w-3", token.spinnerClass)} />
        <Badge
          variant="outline"
          className={cn("font-mono text-[10px] font-semibold tracking-wider", token.badgeClass)}
        >
          {token.label}
        </Badge>
        <span className="thinking-glow text-[11px] font-medium text-muted-foreground">
          Queued
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {content}
        </span>
      </div>
    </div>
  )
}
