import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { getPhaseToken } from "@/lib/phase-tokens"
import { MarkdownContent, extractPreview } from "@/components/markdown-content"
import { Button } from "@/components/ui/button"
import { ChevronRight, ChevronsUpDown, Clock, ListChecks } from "lucide-react"
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

const MID_BADGE_STYLE = "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/25"
const FAST_BADGE_STYLE = "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25"

/** Shorten long model identifiers for display */
function shortModelName(name: string): string {
  // claude-sonnet-4-5-20250514 -> sonnet-4.5
  const m = name.match(/^claude-(sonnet|opus|haiku)-(\d+)-(\d+)/)
  if (m) return `${m[1]}-${m[2]}.${m[3]}`
  // gpt-5.4 etc. are already short
  if (name.length <= 12) return name
  // codex-mini-latest -> codex-mini
  const dash = name.lastIndexOf("-")
  if (dash > 8) return name.slice(0, dash)
  return name
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

interface TurnCardProps {
  turn: Turn
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TurnCard({ turn, open, onOpenChange }: TurnCardProps) {
  const isError = turn.status === "error"
  const label = LABEL_MAP[turn.from] || turn.from.toUpperCase()
  const phaseToken = getPhaseToken(turn.phase)

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div
        className={cn(
          "overflow-hidden rounded-lg border-l-[3px] bg-card/60 ring-1 shadow-sm transition-all duration-200 hover:shadow-md",
          isError
            ? "border-l-red-500 ring-red-500/20"
            : cn(ACCENT_COLORS[turn.from] || "border-l-muted-foreground", "ring-border/10 hover:ring-border/20")
        )}
      >
        <CollapsibleTrigger asChild>
          <button className="flex w-full cursor-pointer flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-muted/30">
            {/* Row 1: Speaker + turn # + content preview */}
            <div className="flex w-full items-center gap-2">
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
              {!open && (
                <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground/70">
                  {extractPreview(turn.content)}
                </span>
              )}
              {open && <span className="flex-1" />}
            </div>
            {/* Row 2: Phase + model + duration + timestamp */}
            <div className="flex w-full items-center gap-2 pl-5">
              {turn.from !== "human" && (
                <Badge
                  variant="outline"
                  className={cn(
                    "font-mono text-[9px] font-normal tracking-wide",
                    phaseToken.badgeClass
                  )}
                >
                  {phaseToken.label}
                </Badge>
              )}
              {turn.model_name && (
                <Badge
                  variant="outline"
                  className={cn(
                    "hidden font-mono text-[9px] font-normal tracking-wide @md:inline-flex md:inline-flex",
                    turn.model_tier === "fast" ? FAST_BADGE_STYLE
                      : turn.model_tier === "mid" ? MID_BADGE_STYLE
                      : "bg-muted/50 text-muted-foreground border-border/50"
                  )}
                >
                  {shortModelName(turn.model_name)}
                </Badge>
              )}
              {turn.duration_ms != null && (
                <span className="hidden shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70 @md:flex md:flex">
                  <Clock className="h-3 w-3" />
                  {formatDuration(turn.duration_ms)}
                </span>
              )}
              <span className="flex-1" />
              <span className="hidden shrink-0 font-mono text-[10px] text-muted-foreground/50 @sm:inline sm:inline">
                {formatTimestamp(turn.timestamp)}
              </span>
            </div>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/40 px-4 py-3">
            <MarkdownContent content={turn.content} />
          </div>
          {turn.decisions?.length > 0 && (
            <div className="border-t border-border/30 px-4 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <ListChecks className="h-3 w-3 text-muted-foreground/60" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  Decisions
                </span>
              </div>
              <ul className="space-y-1 pl-5">
                {turn.decisions.map((d, i) => (
                  <li
                    key={i}
                    className="list-disc text-[12px] leading-relaxed text-foreground/70 marker:text-muted-foreground/30"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex justify-center border-t border-border/20 py-1.5">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground/60 hover:text-muted-foreground"
              onClick={() => onOpenChange(false)}
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
