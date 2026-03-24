import { useCallback, useEffect } from "react"
import { Toaster } from "@/components/ui/sonner"
import { usePolling } from "@/hooks/use-polling"
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
  } = usePolling()

  const isCompleted = sessionStatus === "completed"

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
      />
      <InterjectionInput disabled={isCompleted} />
      <StatusBar
        statusText={statusText}
        turnCount={turnCount}
        sessionStatus={sessionStatus}
        sessionTimer={sessionTimer}
      />
      <Toaster position="bottom-right" />
    </div>
  )
}
