import { useCallback, useEffect, useState } from "react"
import { Toaster } from "@/components/ui/sonner"
import { useSessionData } from "@/hooks/use-session-data"
import { endSession } from "@/lib/api"
import { SessionHeader } from "@/components/session-header"
import { PauseBanner } from "@/components/pause-banner"
import { Transcript } from "@/components/transcript"
import { InterjectionInput } from "@/components/interjection-input"
import { StatusBar } from "@/components/status-bar"

export default function App() {
  const {
    turns,
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
      />
      <InterjectionInput disabled={isCompleted} />
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
