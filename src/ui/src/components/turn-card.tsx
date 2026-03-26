import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ChevronRight, ChevronsUpDown, Clock } from "lucide-react"
import type { Turn } from "@/lib/types"
import { MarkdownContent } from "./markdown-content"

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

function truncateContent(content: string, decisions?: string[]): string {
  if (decisions && decisions.length > 0) {
    const first = decisions[0]
    const prefix = decisions.length === 1
      ? "Decision: "
      : `Decisions (${decisions.length}): `
    const maxLen = 120 - prefix.length
    const truncated = first.length > maxLen ? first.slice(0, maxLen) + "\u2026" : first
    return prefix + truncated
  }
  if (!content) return ""
  // Strip YAML frontmatter before extracting preview
  const stripped = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "")
  const lines = stripped.split(/\r?\n/)
  const trimmed = lines.map(function (l) { return l.trim() })
  const line = trimmed.find(function (l) {
    return l.length > 0 && !l.startsWith("---") && !l.startsWith("``" + "`")
  })
  if (!line) return ""
  const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/^[-*]\s+/, "")
  if (clean.length > 120) return clean.slice(0, 120) + "\u2026"
  return clean
}

interface TurnCardProps {
  turn: Turn
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TurnCard({ turn, open, onOpenChange }: TurnCardProps) {
  const isError = turn.status === "error"
  const label = LABEL_MAP[turn.from] || turn.from.toUpperCase()

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
            {turn.model_name && (
              <Badge
                variant="outline"
                className={cn(
                  "font-mono text-[9px] font-normal tracking-wide",
                  turn.model_tier === "fast" ? FAST_BADGE_STYLE
                    : turn.model_tier === "mid" ? MID_BADGE_STYLE
                    : "bg-muted/50 text-muted-foreground border-border/50"
                )}
              >
                {turn.model_name}
              </Badge>
            )}
            {turn.duration_ms != null && (
              <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
                <Clock className="h-3 w-3" />
                {formatDuration(turn.duration_ms)}
              </span>
            )}
            {!open && (
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/70">
                {truncateContent(turn.content, turn.decisions)}
              </span>
            )}
            {open && <span className="flex-1" />}
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">
              {formatTimestamp(turn.timestamp)}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t border-border/40 px-4 py-3">
            <MarkdownContent content={turn.content} />
          </div>
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