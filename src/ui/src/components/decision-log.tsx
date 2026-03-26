import { useEffect, useRef, useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronRight, ListChecks } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SessionPhase } from "@/lib/types"

const AGENT_BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  codex: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  human: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25",
  system: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
}

const AGENT_LABELS: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
  human: "USER",
  system: "SYSTEM",
}

interface DecisionLogProps {
  entries: { text: string; from: string; turn: number }[]
  phase: SessionPhase
}

export function DecisionLog({ entries, phase }: DecisionLogProps) {
  const shouldBeOpen = phase === "plan" || phase === "debate"
  const [open, setOpen] = useState(shouldBeOpen)
  const prevPhaseRef = useRef(phase)

  // Sync collapse state when phase transitions
  useEffect(() => {
    if (prevPhaseRef.current !== phase) {
      prevPhaseRef.current = phase
      setOpen(phase === "plan" || phase === "debate")
    }
  }, [phase])

  if (entries.length === 0) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="animate-slide-up overflow-hidden rounded-lg border border-border/30 bg-card/40">
        <CollapsibleTrigger asChild>
          <button className="flex w-full cursor-pointer items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/30">
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90"
              )}
            />
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
            <span className="text-[12px] font-semibold tracking-tight text-foreground/80">
              Decision Log
            </span>
            <Badge
              variant="outline"
              className="font-mono text-[9px] font-normal text-muted-foreground"
            >
              {entries.length}
            </Badge>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/20 px-4 py-2.5">
            <ul className="space-y-1.5">
              {entries.map((entry, i) => (
                <li key={i} className="flex items-start gap-2">
                  <div className="mt-0.5 flex shrink-0 items-center gap-1.5">
                    <Badge
                      variant="outline"
                      className={cn(
                        "font-mono text-[8px] font-semibold tracking-wider",
                        AGENT_BADGE_STYLES[entry.from]
                      )}
                    >
                      {AGENT_LABELS[entry.from] || entry.from.toUpperCase()}
                    </Badge>
                    <span className="font-mono text-[10px] text-muted-foreground/50">
                      #{entry.turn}
                    </span>
                  </div>
                  <span className="text-[12px] leading-relaxed text-foreground/75">
                    {entry.text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
