import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
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

function elapsedStr(since: string): string {
  const secs = Math.round((Date.now() - new Date(since).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
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
        <span className="text-sm text-muted-foreground">
          <span className="inline-block animate-pulse">Thinking</span>
          {" "}
          <span>{elapsed || elapsedStr(thinking.since)}</span>
        </span>
      </CardContent>
    </Card>
  )
}
