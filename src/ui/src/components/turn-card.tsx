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

const LABEL_MAP: Record<string, string> = {
  claude: "CLAUDE",
  codex: "CODEX",
  human: "USER",
  system: "SYSTEM",
}

const ACCENT_COLORS: Record<string, string> = {
  claude: "border-l-blue-500",
  codex: "border-l-emerald-500",
  human: "border-l-violet-400",
  system: "border-l-amber-500",
}

const BADGE_STYLES: Record<string, string> = {
  claude: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  codex: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  human: "bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/25",
  system: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
}

const PHASE_STYLES: Record<string, string> = {
  plan: "bg-orange-500/10 text-orange-600/70 dark:text-orange-400/70 border-orange-500/20",
  debate: "bg-orange-500/10 text-orange-600/70 dark:text-orange-400/70 border-orange-500/20",
  implement: "bg-cyan-500/10 text-cyan-600/70 dark:text-cyan-400/70 border-cyan-500/20",
  review: "bg-pink-500/10 text-pink-600/70 dark:text-pink-400/70 border-pink-500/20",
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

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return totalSeconds + "s"
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (seconds > 0) return minutes + "m " + seconds + "s"
  return minutes + "m"
}

function truncateContent(content: string): string {
  if (!content) return ""
  const lines = content.split(/\r?\n/)
  const trimmed = lines.map(function (l) { return l.trim() })
  const line = trimmed.find(function (l) {
    return l.length > 0 && !l.startsWith("---") && !l.startsWith("``" + "`")
  })
  if (!line) return ""
  const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "")
  if (clean.length > 120) return clean.slice(0, 120) + "\u2026"
  return clean
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
                  ? "border-red-500/25 bg-red-500/15 text-red-600 dark:text-red-400"
                  : BADGE_STYLES[turn.from]
              )}
            >
              {label}
            </Badge>
            <span className="font-mono text-[11px] text-muted-foreground">
              #{turn.turn}
            </span>
            {turn.from !== "human" && (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[9px] font-normal tracking-wide",
                  PHASE_STYLES[turn.phase] || "bg-muted text-muted-foreground"
                )}
              >
                {turn.phase}
              </Badge>
            )}
            {!open && (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/40">
                {truncateContent(turn.content)}
              </span>
            )}
            {open && <span className="flex-1" />}
            {turn.duration_ms != null && (
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground/40">
                {formatDuration(turn.duration_ms)}
              </span>
            )}
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