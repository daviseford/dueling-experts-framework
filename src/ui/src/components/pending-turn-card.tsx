import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"

interface PendingTurnCardProps {
  content: string
}

export function PendingTurnCard({ content }: PendingTurnCardProps) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-lg border-l-[3px] border-l-violet-400 bg-card/60 opacity-60 ring-1 ring-border/10">
      <div className="flex items-center gap-2 px-3 py-2">
        <Spinner className="h-3 w-3 text-violet-500" />
        <Badge
          variant="outline"
          className="font-mono text-[10px] font-semibold tracking-wider bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25"
        >
          USER
        </Badge>
        <span className="thinking-glow text-[11px] text-muted-foreground">
          Queued
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
          {content}
        </span>
      </div>
    </div>
  )
}
