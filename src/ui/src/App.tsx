import { useCallback, useEffect, useMemo, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { useSessionList } from "@/hooks/use-explorer"
import { useMediaQuery } from "@/hooks/use-media-query"
import { endSession } from "@/lib/api"
import { SessionHeader } from "@/components/session-header"
import { SessionTabBar } from "@/components/session-tab-bar"
import { SessionPanel } from "@/components/session-panel"
import { EmptyState } from "@/components/empty-state"
import { cn } from "@/lib/utils"
import type { ViewMode } from "@/lib/types"

const VIEW_MODE_KEY = "def-view-mode"
const DISMISSED_KEY = "def-dismissed-sessions"
const MIN_GRID_WIDTH = 768

export default function App() {
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
  } = useSessionList()

  // Get selected session metadata from the session list (avoids spinning up a full polling hook)
  const selectedSession = useMemo(
    () => sessions.find(s => s.id === selectedSessionId),
    [sessions, selectedSessionId]
  )
  const topic = selectedSession?.topic ?? ""
  const sessionStatus = selectedSession?.session_status ?? "active"

  const handleEndSession = useCallback(async () => {
    if (selectedSessionId) {
      try { await endSession(selectedSessionId) } catch { /* session may already be ended */ }
    }
  }, [selectedSessionId])

  // View mode state with localStorage persistence
  const [viewModePreference, setViewModePreference] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY)
      return stored === "grid" ? "grid" : "single"
    } catch {
      return "single"
    }
  })
  const isWideEnough = useMediaQuery(`(min-width: ${MIN_GRID_WIDTH}px)`)

  // Dismissed sessions (hidden from tab bar, persisted to localStorage)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(DISMISSED_KEY)
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !dismissedIds.has(s.id)),
    [sessions, dismissedIds]
  )

  // Effective view mode: preference AND viewport >= 768px AND >= 2 visible sessions
  const canShowGrid = isWideEnough && visibleSessions.length >= 2
  const effectiveViewMode: ViewMode = canShowGrid && viewModePreference === "grid" ? "grid" : "single"
  const isGrid = effectiveViewMode === "grid"

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModePreference(mode)
    try { localStorage.setItem(VIEW_MODE_KEY, mode) } catch { /* quota */ }
  }, [])

  const handleToggleViewMode = useCallback(() => {
    setViewMode(viewModePreference === "grid" ? "single" : "grid")
  }, [viewModePreference, setViewMode])

  const handleDismissSession = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id)
      try { localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next])) } catch { /* quota */ }
      return next
    })
    // If the dismissed session was selected, pick the next best tab
    if (id === selectedSessionId) {
      const remaining = sessions.filter((s) => s.id !== id && !dismissedIds.has(s.id))
      const next = remaining.find((s) => s.session_status === "active" || s.session_status === "paused")
        ?? remaining[0]
      if (next) setSelectedSessionId(next.id)
    }
  }, [sessions, selectedSessionId, dismissedIds, setSelectedSessionId])

  // Grid sessions: first 4 visible sessions
  const gridSessions = useMemo(
    () => visibleSessions.slice(0, 4),
    [visibleSessions]
  )
  const gridCount = gridSessions.length

  // Document title
  useEffect(() => {
    if (isGrid) {
      document.title = `DEF \u2014 ${gridCount} session${gridCount !== 1 ? "s" : ""}`
    } else if (topic) {
      const short = topic.length > 30 ? topic.slice(0, 30) + "\u2026" : topic
      document.title = `DEF - ${short}`
    } else {
      document.title = "DEF"
    }
  }, [topic, isGrid, gridCount])

  const hasAnySessions = sessions.length > 0

  // Tab bar: hidden in grid mode OR when <= 1 session
  const showTabBar = !isGrid && visibleSessions.length > 1

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SessionHeader
        topic={topic}
        sessionId={selectedSessionId}
        sessions={visibleSessions}
        viewMode={effectiveViewMode}
        canShowGrid={canShowGrid}
        sessionStatus={sessionStatus}
        onToggleViewMode={handleToggleViewMode}
        onEndSession={handleEndSession}
      />
      {showTabBar && (
        <SessionTabBar
          sessions={visibleSessions}
          selectedSessionId={selectedSessionId}
          onSelectSession={setSelectedSessionId}
          onDismissSession={handleDismissSession}
        />
      )}
      {!hasAnySessions ? (
        <EmptyState />
      ) : isGrid ? (
        <div
          className={cn(
            "grid min-h-0 flex-1 gap-1",
            gridCount <= 1 && "grid-cols-1",
            gridCount >= 2 && "grid-cols-2",
            gridCount >= 3 && "grid-rows-[1fr_1fr]",
          )}
        >
          {gridSessions.map((s, i) => (
            <SessionPanel
              key={s.id}
              sessionId={s.id}
              sessions={sessions}
              showPanelHeader
              showMaximize
              showDismiss
              onMaximize={() => {
                setSelectedSessionId(s.id)
                setViewMode("single")
              }}
              onDismiss={() => handleDismissSession(s.id)}
              className={cn(gridCount === 3 && i === 2 && "col-span-2")}
            />
          ))}
        </div>
      ) : (
        <SessionPanel
          key={selectedSessionId}
          sessionId={selectedSessionId}
          sessions={sessions}
        />
      )}
      <Toaster position="bottom-right" />
    </div>
  )
}
