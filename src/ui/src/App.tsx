import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import { useExplorer } from "@/hooks/use-explorer"
import { endSession } from "@/lib/api"
import { SessionHeader } from "@/components/session-header"
import { SessionTabBar } from "@/components/session-tab-bar"
import { PauseBanner } from "@/components/pause-banner"
import { Transcript } from "@/components/transcript"
import { InterjectionInput } from "@/components/interjection-input"
import { StatusBar } from "@/components/status-bar"
import { EmptyState } from "@/components/empty-state"
import type { PendingInterjection } from "@/lib/types"

export default function App() {
  const {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    turns,
    sessionId,
    sessionStatus,
    topic,
    turnCount,
    thinking,
    thinkingElapsed,
    statusText,
    sessionTimer,
    phase,
    branchName,
    prUrl,
    prNumber,
    turnsPath,
    artifactsPath,
  } = useExplorer()

  const isReadOnly = sessionStatus !== "active"
  const isCompleted = sessionStatus === "completed"

  // Dismissed sessions (hidden from tab bar, client-side only)
  // Interrupted (stale) sessions are auto-hidden — their process is dead
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !dismissedIds.has(s.id) && s.session_status !== "interrupted"),
    [sessions, dismissedIds]
  )
  const handleDismissSession = useCallback((id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id))
    // If the dismissed session was selected, pick the next best tab
    if (id === selectedSessionId) {
      const remaining = sessions.filter((s) => s.id !== id && !dismissedIds.has(s.id))
      const next = remaining.find((s) => s.session_status === "active" || s.session_status === "paused")
        ?? remaining[0]
      if (next) setSelectedSessionId(next.id)
    }
  }, [sessions, selectedSessionId, dismissedIds, setSelectedSessionId])

  // Pending interjections: messages sent but not yet processed into turns
  const [pendingInterjections, setPendingInterjections] = useState<PendingInterjection[]>([])
  const prevPhaseRef = useRef(phase)
  const prevSelectedRef = useRef(selectedSessionId)

  // Reset state when switching sessions
  useEffect(() => {
    if (prevSelectedRef.current !== selectedSessionId) {
      prevSelectedRef.current = selectedSessionId
      setPendingInterjections([])
      setOpenMap({})
      prevPhaseRef.current = phase
    }
  }, [selectedSessionId, phase])

  const handleInterjectionSent = useCallback((content: string) => {
    setPendingInterjections((prev) => [
      ...prev,
      { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content },
    ])
  }, [])

  // Count-based reconciliation: for each content string, keep only unmatched pending items.
  const visiblePending = useMemo(() => {
    const humanCounts = new Map<string, number>()
    for (const t of turns) {
      if (t.from === "human") {
        humanCounts.set(t.content, (humanCounts.get(t.content) ?? 0) + 1)
      }
    }
    const consumed = new Map<string, number>()
    return pendingInterjections.filter((p) => {
      const available = (humanCounts.get(p.content) ?? 0) - (consumed.get(p.content) ?? 0)
      if (available > 0) {
        consumed.set(p.content, (consumed.get(p.content) ?? 0) + 1)
        return false
      }
      return true
    })
  }, [turns, pendingInterjections])

  // Garbage-collect reconciled pending items from state
  useEffect(() => {
    if (visiblePending.length < pendingInterjections.length) {
      setPendingInterjections(visiblePending)
    }
  }, [visiblePending, pendingInterjections.length])

  // Detect dropped interjections: clear pending items when phase leaves plan
  useEffect(() => {
    const prevPhase = prevPhaseRef.current
    prevPhaseRef.current = phase
    if (prevPhase === "plan" && phase !== "plan" && visiblePending.length > 0) {
      const count = visiblePending.length
      setPendingInterjections([])
      toast.info(
        count === 1
          ? "Your queued message was not delivered — agents moved past the planning phase."
          : `${count} queued messages were not delivered — agents moved past the planning phase.`
      )
    }
  }, [phase, visiblePending])

  // Per-turn open state, keyed by turn id. New turns default to open.
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({})
  const allCollapsed = turns.length > 0 && turns.every((t) => openMap[t.id] === false)

  useEffect(() => {
    setOpenMap((prev) => {
      const next = { ...prev }
      for (const t of turns) {
        if (!(t.id in next)) next[t.id] = true
      }
      return next
    })
  }, [turns])

  const handleTurnOpenChange = useCallback((id: string, open: boolean) => {
    setOpenMap((prev) => ({ ...prev, [id]: open }))
  }, [])

  const handleToggleAll = useCallback(() => {
    setOpenMap((prev) => {
      const next = { ...prev }
      const newValue = allCollapsed
      for (const t of turns) {
        next[t.id] = newValue
      }
      return next
    })
  }, [turns, allCollapsed])

  useEffect(() => {
    if (topic) {
      const short = topic.length > 30 ? topic.slice(0, 30) + "\u2026" : topic
      document.title = `DEF - ${short}`
    }
  }, [topic])

  const handleEndSession = useCallback(async () => {
    await endSession(selectedSessionId)
  }, [selectedSessionId])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SessionHeader
        topic={topic}
        sessionId={sessionId}
        disabled={isCompleted}
        isReadOnly={isReadOnly}
        onEndSession={handleEndSession}
      />
      <SessionTabBar
        sessions={visibleSessions}
        selectedSessionId={selectedSessionId}
        onSelectSession={setSelectedSessionId}
        onDismissSession={handleDismissSession}
      />
      {sessions.length === 0 && turns.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <PauseBanner visible={sessionStatus === "paused"} isReadOnly={isReadOnly} />
          <Transcript
            turns={turns}
            thinking={thinking}
            thinkingElapsed={thinkingElapsed}
            phase={phase}
            sessionStatus={sessionStatus}
            branchName={branchName}
            prUrl={prUrl}
            prNumber={prNumber}
            turnsPath={turnsPath}
            artifactsPath={artifactsPath}
            openMap={openMap}
            onTurnOpenChange={handleTurnOpenChange}
            pendingInterjections={visiblePending}
          />
          <InterjectionInput sessionId={selectedSessionId} disabled={isCompleted} isReadOnly={isReadOnly} onSent={handleInterjectionSent} />
        </>
      )}
      <StatusBar
        statusText={statusText}
        turnCount={turnCount}
        sessionStatus={sessionStatus}
        sessionTimer={sessionTimer}
        allCollapsed={allCollapsed}
        onToggleAll={handleToggleAll}
      />
      <Toaster position="bottom-right" />
    </div>
  )
}
