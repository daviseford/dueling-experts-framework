import { useRef, useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Home } from "lucide-react"
import { cn } from "@/lib/utils"
import type { SessionSummary } from "@/lib/types"

interface SessionTabBarProps {
  sessions: SessionSummary[]
  selectedSessionId: string
  onSelectSession: (id: string) => void
  owningSessionId: string | null
}

function statusDotClass(status: string): string {
  switch (status) {
    case "active":
      return "bg-green-500"
    case "paused":
      return "bg-amber-500 animate-pulse"
    case "completed":
      return "bg-zinc-400 dark:bg-zinc-500"
    case "interrupted":
      return "bg-red-500"
    default:
      return "bg-zinc-400"
  }
}

function phaseBadgeVariant(phase: string): string {
  switch (phase) {
    case "plan":
      return "text-blue-600 bg-blue-500/10 dark:text-blue-400"
    case "implement":
      return "text-green-600 bg-green-500/10 dark:text-green-400"
    case "review":
      return "text-purple-600 bg-purple-500/10 dark:text-purple-400"
    default:
      return ""
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max) + "\u2026"
}

export function SessionTabBar({
  sessions,
  selectedSessionId,
  onSelectSession,
  owningSessionId,
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

  if (sessions.length <= 1) return null

  return (
    <div className="relative flex items-center border-b border-border/30 bg-card/60">
      {canScrollLeft && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 z-10 h-full w-7 rounded-none bg-gradient-to-r from-card/90 to-transparent"
          onClick={() => scroll("left")}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
      )}
      <div
        ref={scrollRef}
        className="flex w-full overflow-x-auto scrollbar-none"
      >
        {sessions.map((s) => {
          const isSelected = s.id === selectedSessionId
          const isOwning = s.id === owningSessionId
          return (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={cn(
                "group relative flex min-w-[140px] max-w-[220px] shrink-0 items-center gap-2 border-r border-border/40 px-3 py-2 text-left transition-colors",
                isSelected
                  ? "bg-background"
                  : "bg-transparent hover:bg-background/40"
              )}
            >
              {/* Status dot */}
              <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDotClass(s.session_status))} />

              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {multiRepo && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50">
                    {s.repo}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-[12px] font-medium leading-tight text-foreground/90">
                  {isOwning && <Home className="h-2.5 w-2.5 shrink-0 text-teal-500" />}
                  <span className="truncate">{truncate(s.topic, 30)}</span>
                </span>
              </div>

              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 border-0 px-1.5 py-0 text-[9px] font-medium uppercase",
                  phaseBadgeVariant(s.phase)
                )}
              >
                {s.phase === "plan" ? "plan" : s.phase === "implement" ? "impl" : s.phase}
              </Badge>

              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute inset-x-0 bottom-0 h-0.5 bg-teal-500" />
              )}
            </button>
          )
        })}
      </div>
      {canScrollRight && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 z-10 h-full w-7 rounded-none bg-gradient-to-l from-card/90 to-transparent"
          onClick={() => scroll("right")}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
