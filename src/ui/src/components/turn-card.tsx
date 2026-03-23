import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Turn } from "@/lib/types"

// TODO: make configurable
const LABEL_MAP: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
  human: "DAVIS",
  system: "SYSTEM",
}

const HEADER_STYLES: Record<string, string> = {
  claude: "bg-blue-950/60 text-blue-400",
  codex: "bg-green-950/60 text-green-400",
  human: "bg-purple-950/60 text-purple-400",
  system: "bg-yellow-950/60 text-yellow-400",
}

const BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-900/50 text-blue-300 border-blue-700/50",
  codex: "bg-green-900/50 text-green-300 border-green-700/50",
  human: "bg-purple-900/50 text-purple-300 border-purple-700/50",
  system: "bg-yellow-900/50 text-yellow-300 border-yellow-700/50",
}

interface TurnCardProps {
  turn: Turn
}

export function TurnCard({ turn }: TurnCardProps) {
  const isError = turn.status === "error"
  const label = LABEL_MAP[turn.from] || turn.from.toUpperCase()

  return (
    <Card
      className={cn(
        "overflow-hidden",
        isError && "border-red-600"
      )}
    >
      <CardHeader
        className={cn(
          "flex flex-row items-center justify-between px-3 py-2",
          isError
            ? "bg-red-950/60 text-red-400"
            : HEADER_STYLES[turn.from] || "bg-muted text-muted-foreground"
        )}
      >
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-semibold",
              isError
                ? "border-red-700/50 bg-red-900/50 text-red-300"
                : BADGE_STYLES[turn.from]
            )}
          >
            {label}
          </Badge>
          <span className="text-xs font-medium">Turn {turn.turn}</span>
        </div>
        <span className="text-xs opacity-70">{turn.timestamp || ""}</span>
      </CardHeader>
      <CardContent className="p-3">
        <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-foreground">
          {turn.content}
        </pre>
      </CardContent>
    </Card>
  )
}
