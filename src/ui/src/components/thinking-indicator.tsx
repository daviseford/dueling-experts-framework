import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { ThinkingState } from "@/lib/types"

const LABEL_MAP: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
}

const HEADER_STYLES: Record<string, string> = {
  claude: "bg-blue-950/60 text-blue-400",
  codex: "bg-green-950/60 text-green-400",
}

const BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-900/50 text-blue-300 border-blue-700/50",
  codex: "bg-green-900/50 text-green-300 border-green-700/50",
}

interface ThinkingIndicatorProps {
  thinking: ThinkingState
  elapsed: string
}

export function ThinkingIndicator({ thinking, elapsed }: ThinkingIndicatorProps) {
  const label = LABEL_MAP[thinking.agent] || thinking.agent.toUpperCase()

  return (
    <Card className="overflow-hidden">
      <CardHeader
        className={cn(
          "flex flex-row items-center px-3 py-2",
          HEADER_STYLES[thinking.agent] || "bg-muted text-muted-foreground"
        )}
      >
        <Badge
          variant="outline"
          className={cn(
            "text-xs font-semibold",
            BADGE_STYLES[thinking.agent]
          )}
        >
          {label}
        </Badge>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          <span>Thinking</span>
          <span className="font-mono text-xs">{elapsed}</span>
        </div>
      </CardContent>
    </Card>
  )
}
