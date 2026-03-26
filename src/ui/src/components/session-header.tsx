import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Radio } from "lucide-react"
import type { SessionSummary } from "@/lib/types"

interface SessionHeaderProps {
  topic: string
  sessionId: string
  sessions: SessionSummary[]
  viewMode?: "single" | "grid"
  onToggleViewMode?: () => void
}

export function SessionHeader({ topic, sessionId, sessions, viewMode, onToggleViewMode }: SessionHeaderProps) {
  const isGrid = viewMode === "grid"
  const sessionCount = sessions.length

  return (
    <header className="relative flex items-center justify-between border-b border-border/30 bg-card/80 px-5 py-3 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 shadow-sm">
            <Radio className="h-3.5 w-3.5 text-white" />
          </div>
          <h1 className="text-sm font-bold tracking-tight text-foreground">DEF</h1>
        </div>
        {isGrid ? (
          <>
            <Separator orientation="vertical" className="h-4" />
            <span className="text-[13px] text-muted-foreground">{sessionCount} session{sessionCount !== 1 ? "s" : ""}</span>
          </>
        ) : (
          <>
            {topic && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="text-[13px] text-muted-foreground">{topic}</span>
              </>
            )}
            {sessionId && (
              <>
                <Separator orientation="vertical" className="h-4" />
                <span className="font-mono text-[11px] text-muted-foreground/50">{sessionId}</span>
              </>
            )}
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {/* View mode toggle and ThemeToggle will be added in Unit 3 */}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-teal-500/20 to-transparent" />
    </header>
  )
}
