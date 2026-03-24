import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"
import type { ThinkingState, SessionPhase } from "@/lib/types"

const LABEL_MAP: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
}

const PHASE_LABEL: Record<SessionPhase, string> = {
  debate: "Thinking",
  implement: "Implementing",
  review: "Reviewing",
}

const ACCENT_COLORS: Record<string, string> = {
  claude: "border-l-blue-500",
  codex: "border-l-emerald-500",
}

const BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  codex: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
}

const SPINNER_COLORS: Record<string, string> = {
  claude: "text-blue-600 dark:text-blue-400",
  codex: "text-emerald-600 dark:text-emerald-400",
}

interface ThinkingIndicatorProps {
  thinking: ThinkingState
  elapsed: string
  phase: SessionPhase
}

export function ThinkingIndicator({ thinking, elapsed, phase }: ThinkingIndicatorProps) {
  const label = LABEL_MAP[thinking.agent] || thinking.agent.toUpperCase()

  return (
    <div
      className={cn(
        "rounded-lg border-l-[3px] bg-card/50",
        ACCENT_COLORS[thinking.agent] || "border-l-muted-foreground"
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <Spinner
          className={cn(
            "h-3.5 w-3.5",
            SPINNER_COLORS[thinking.agent] || "text-muted-foreground"
          )}
        />
        <Badge
          variant="outline"
          className={cn(
            "font-mono text-[10px] font-semibold tracking-wider",
            BADGE_STYLES[thinking.agent]
          )}
        >
          {label}
        </Badge>
        <span className="thinking-glow text-[13px] text-muted-foreground">
          {PHASE_LABEL[phase] || "Thinking"}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground/60">
          {elapsed}
        </span>
      </div>
    </div>
  )
}