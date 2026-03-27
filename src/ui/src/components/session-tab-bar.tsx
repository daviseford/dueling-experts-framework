import { useRef, useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { ChevronLeft, ChevronRight, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { getPhaseToken, PHASE_DESCRIPTIONS } from "@/lib/phase-tokens"
import type { SessionSummary } from "@/lib/types"

interface SessionTabBarProps {
  sessions: SessionSummary[]
  selectedSessionId: string
  onSelectSession: (id: string) => void
  onDismissSession?: (id: string) => void
}

const STATUS_BORDER: Record<string, string> = {
  active: "border-l-emerald-500",
  paused: "border-l-amber-500",
  completed: "border-l-zinc-300 dark:border-l-zinc-600",
  interrupted: "border-l-red-400 dark:border-l-red-500",
}

const STATUS_COLOR: Record<string, string> = {
  completed: "text-emerald-600/70 dark:text-emerald-400/70",
  interrupted: "text-red-500/70 dark:text-red-400/70",
  paused: "text-amber-600/70 dark:text-amber-400/70",
}

/** For dead sessions, show outcome status instead of frozen phase. */
function badgeInfo(session: { phase: string; session_status: string }): { label: string; color: string; description: string } {
  if (session.session_status === "completed") {
    return { label: "DONE", color: STATUS_COLOR.completed, description: "Session finished \u2014 all phases complete" }
  }
  if (session.session_status === "interrupted") {
    return { label: "INTERRUPTED", color: STATUS_COLOR.interrupted, description: "Session was stopped before completion" }
  }
  if (session.session_status === "paused") {
    return { label: "PAUSED", color: STATUS_COLOR.paused, description: "Session paused \u2014 human input needed" }
  }
  const token = getPhaseToken(session.phase)
  return { label: token.shortLabel, color: token.textClass, description: PHASE_DESCRIPTIONS[session.phase as keyof typeof PHASE_DESCRIPTIONS] ?? token.label }
}

function isDead(status: string): boolean {
  return status === "completed" || status === "interrupted"
}

function elapsed(created: string): string {
  const ms = Date.now() - new Date(created).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return "<1m"
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h`
  return `${Math.floor(hrs / 24)}d`
}

export function SessionTabBar({
  sessions,
  selectedSessionId,
  onSelectSession,
  onDismissSession,
}: SessionTabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const multiRepo = new Set(sessions.map((s) => s.repo)).size > 1

  const updateScrollState = () => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  useEffect(() => {
    updateScrollState()
    const el = scrollRef.current
    if (el) {
      el.addEventListener("scroll", updateScrollState)
      const ro = new ResizeObserver(updateScrollState)
      ro.observe(el)
      return () => {
        el.removeEventListener("scroll", updateScrollState)
        ro.disconnect()
      }
    }
  }, [sessions])

  const scroll = (dir: "left" | "right") => {
    scrollRef.current?.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" })
  }

  // Roving tabindex: only the selected tab is in the tab order; arrow keys move focus
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent, sessionIndex: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault()
      onSelectSession(sessions[sessionIndex].id)
      return
    }

    let nextIndex: number | null = null
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      nextIndex = (sessionIndex + 1) % sessions.length
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      nextIndex = (sessionIndex - 1 + sessions.length) % sessions.length
    } else if (e.key === "Home") {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === "End") {
      e.preventDefault()
      nextIndex = sessions.length - 1
    }

    if (nextIndex !== null) {
      const nextSession = sessions[nextIndex]
      onSelectSession(nextSession.id)
      tabRefs.current.get(nextSession.id)?.focus()
    }
  }, [sessions, onSelectSession])

  if (sessions.length <= 1) return null

  return (
    <div className="relative flex items-center bg-muted/30 dark:bg-card/30">
      {canScrollLeft && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 z-10 h-full w-7 rounded-none bg-gradient-to-r from-muted/80 to-transparent dark:from-card/80"
          onClick={() => scroll("left")}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      )}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Sessions"
        className="flex w-full overflow-x-auto scrollbar-none"
      >
        {sessions.map((s, index) => {
          const isSelected = s.id === selectedSessionId
          const dead = isDead(s.session_status)
          return (
            <div
              key={s.id}
              ref={(el) => { if (el) tabRefs.current.set(s.id, el); else tabRefs.current.delete(s.id) }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              aria-selected={isSelected}
              onClick={() => onSelectSession(s.id)}
              onKeyDown={(e) => handleTabKeyDown(e, index)}
              className={cn(
                "group relative flex min-w-[180px] max-w-[240px] shrink-0 flex-1 cursor-pointer flex-col border-l-2 border-r border-r-border/20 px-3 py-2 text-left transition-all",
                STATUS_BORDER[s.session_status] || "border-l-zinc-400",
                isSelected
                  ? "bg-background shadow-[inset_0_-2px_0_0] shadow-teal-500"
                  : "bg-transparent hover:bg-background/60",
                dead && !isSelected && "opacity-50 hover:opacity-75"
              )}
            >
              {/* Row 1: Topic + close button */}
              <div className="flex items-start gap-1.5">
                {multiRepo && (
                  <span className="mt-px shrink-0 rounded bg-muted px-1 py-px text-[8px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {s.repo}
                  </span>
                )}
                <span className={cn(
                  "min-w-0 flex-1 truncate text-[12px] font-medium leading-snug",
                  isSelected ? "text-foreground" : "text-foreground/80"
                )}>
                  {s.topic}
                </span>

                {/* Dismiss button */}
                {onDismissSession && (
                  <button
                    type="button"
                    aria-label={`Dismiss ${s.topic}`}
                    className="mt-px shrink-0 rounded p-0.5 text-muted-foreground/30 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      onDismissSession(s.id)
                    }}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Row 2: Status/phase badge + turn count + elapsed */}
              <div className="mt-1 flex items-center gap-2 text-[10px]">
                {(() => { const b = badgeInfo(s); return (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className={cn("font-semibold tracking-wider", b.color)}>
                      {b.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{b.description}</TooltipContent>
                </Tooltip>
                ) })()}
                <span className="text-muted-foreground/60">&middot;</span>
                <span className="font-mono text-muted-foreground/70">
                  {s.current_turn === 0
                    ? "starting"
                    : s.current_turn === 1
                      ? "1 turn"
                      : `${s.current_turn} turns`}
                </span>
                <span className="text-muted-foreground/60">&middot;</span>
                <span className="text-muted-foreground/70">
                  {elapsed(s.created)}
                </span>
              </div>
            </div>
          )
        })}
      </div>
      {canScrollRight && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 z-10 h-full w-7 rounded-none bg-gradient-to-l from-muted/80 to-transparent dark:from-card/80"
          onClick={() => scroll("right")}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
