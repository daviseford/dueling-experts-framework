import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { toast } from "sonner"
import { useSessionData } from "@/hooks/use-session-data"
import { endSession } from "@/lib/api"
import { SessionHeader } from "@/components/session-header"
import { PauseBanner } from "@/components/pause-banner"
import { Transcript } from "@/components/transcript"
import { InterjectionInput } from "@/components/interjection-input"
import { StatusBar } from "@/components/status-bar"
import type { PendingInterjection } from "@/lib/types"

export default function App() {
  const {
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
  } = useSessionData()

  const isCompleted = sessionStatus === "completed"

  // Pending interjections: messages sent but not yet processed into turns
  const [pendingInterjections, setPendingInterjections] = useState<PendingInterjection[]>([])
  const prevPhaseRef = useRef(phase)

  const handleInterjectionSent = useCallback((content: string) => {
    setPendingInterjections((prev) => [
      ...prev,
      { id: `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, content },
    ])
  }, [])

  // Count-based reconciliation: for each content string, keep only unmatched pending items.
  // This correctly handles duplicate messages (e.g. "yes" sent twice).
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

  // Detect dropped interjections: clear pending items when phase is not plan
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
      const short = topic.length > 30 ? topic.slice(0, 30) + "…" : topic
      document.title = `DEF - ${short}`
    }
  }, [topic])

  const handleEndSession = useCallback(async () => {
    await endSession()
  }, [])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <SessionHeader
        topic={topic}
        sessionId={sessionId}
        disabled={isCompleted}
        onEndSession={handleEndSession}
      />
      <PauseBanner visible={sessionStatus === "paused"} />
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
      <InterjectionInput disabled={isCompleted} onSent={handleInterjectionSent} />
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
