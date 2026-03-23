import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronRight, ChevronsUpDown } from "lucide-react"
import type { Turn } from "@/lib/types"

// TODO: make configurable
const LABEL_MAP: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
  human: "DAVIS",
  system: "SYSTEM",
}

const ACCENT_COLORS: Record<string, string> = {
  claude: "border-l-blue-500",
  codex: "border-l-emerald-500",
  human: "border-l-violet-400",
  system: "border-l-amber-500",
}

const BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-500/15 text-blue-400 border-blue-500/25",
  codex: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  human: "bg-violet-500/15 text-violet-400 border-violet-500/25",
  system: "bg-amber-500/15 text-amber-400 border-amber-500/25",
}

function formatTimestamp(ts: string): string {
  if (!ts) return ""
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    })
  } catch {
    return ts
  }
}

function truncateContent(content: string): string {
  if (!content) return ""
  // Take the first non-empty line, strip markdown headers/formatting
  const line = content
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(l => l.length > 0 && !l.startsWith("---") && !l.startsWith("```"))
  if (!line) return ""
  const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "")
  return clean.length > 120 ? clean.slice(0, 120) + "…" : clean
}

interface TurnCardProps {
  turn: Turn
  defaultOpen?: boolean
}

export function TurnCard({ turn, defaultOpen = true }: TurnCardProps) {
  const [open, setOpen] = useState(defaultOpen)
  const isError = turn.status === "error"
  const label = LABEL_MAP[turn.from] || turn.from.toUpperCase()

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={cn(
          "rounded-lg border-l-[3px] bg-card/50 transition-colors",
          isError
            ? "border-l-red-500 ring-1 ring-red-500/20"
            : ACCENT_COLORS[turn.from] || "border-l-muted-foreground"
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/30">
            <ChevronRight
              className={cn(
                "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-90"
              )}
            />
            <Badge
              variant="outline"
              className={cn(
                "font-mono text-[10px] font-semibold tracking-wider",
                isError
                  ? "border-red-500/25 bg-red-500/15 text-red-400"
                  : BADGE_STYLES[turn.from]
              )}
            >
              {label}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              #{turn.turn}
            </span>
            {!open && (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/40">
                {truncateContent(turn.content)}
              </span>
            )}
            {open && <span className="flex-1" />}
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/60">
              {formatTimestamp(turn.timestamp)}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/50 px-4 py-3">
            <pre className="whitespace-pre-wrap font-mono text-[13px] leading-relaxed text-foreground/90">
              {turn.content}
            </pre>
          </div>
          <div className="flex justify-center border-t border-border/30 py-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              <ChevronsUpDown className="h-3 w-3" />
              Collapse
            </Button>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
