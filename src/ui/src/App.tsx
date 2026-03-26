import { useCallback, useEffect, useMemo, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { useSessionList } from "@/hooks/use-explorer"
import { useSessionTurns } from "@/hooks/use-session-turns"
import { SessionHeader } from "@/components/session-header"
import { SessionTabBar } from "@/components/session-tab-bar"
import { SessionPanel } from "@/components/session-panel"
import { EmptyState } from "@/components/empty-state"

export default function App() {
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
  } = useSessionList()

  // Get topic for the selected session (used for document.title in single mode)
  const { topic } = useSessionTurns(selectedSessionId, sessions)

  // Dismissed sessions (hidden from tab bar, persisted to localStorage)
  const DISMISSED_KEY = "def-dismissed-sessions"
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

  // Document title
  useEffect(() => {
    if (topic) {
      const short = topic.length > 30 ? topic.slice(0, 30) + "\u2026" : topic
      document.title = `DEF - ${short}`
    }
  }, [topic])

  const hasAnySessions = sessions.length > 0

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SessionHeader
        topic={topic}
        sessionId={selectedSessionId}
        sessions={visibleSessions}
      />
      <SessionTabBar
        sessions={visibleSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onDismissSession={handleDismissSession}
      />
      {!hasAnySessions ? (
        <EmptyState />
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
