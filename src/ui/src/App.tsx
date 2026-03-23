import { useCallback } from "react"
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
  } = usePolling()

  const isCompleted = sessionStatus === "completed"

  const handleEndSession = useCallback(async () => {
    await endSession()
  }, [])

  return (
    <div className="flex h-screen flex-col">
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
      />
      <InterjectionInput disabled={isCompleted} />
      <StatusBar statusText={statusText} turnCount={turnCount} />
      <Toaster position="bottom-right" />
    </div>
  )
}
