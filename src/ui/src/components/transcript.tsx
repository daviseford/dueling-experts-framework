import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TurnCard } from "./turn-card"
import { ThinkingIndicator } from "./thinking-indicator"
import { SessionSummary } from "./session-summary"
import type { Turn, ThinkingState, SessionPhase } from "@/lib/types"

interface TranscriptProps {
  turns: Turn[]
  thinking: ThinkingState | null
  thinkingElapsed: string
  phase: SessionPhase
  sessionStatus: "active" | "paused" | "completed" | "interrupted"
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  artifactNames: string[]
}

export function Transcript({
  turns,
  thinking,
  thinkingElapsed,
  phase,
  sessionStatus,
  branchName,
  prUrl,
  prNumber,
  turnsPath,
  artifactsPath,
  artifactNames,
}: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const turnCount = turns.length
  const thinkingAgent = thinking?.agent ?? null

  // Only auto-scroll on new turns, thinking agent change, or session completion
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" })
  }, [turnCount, thinkingAgent, sessionStatus])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 px-5 py-4">
        {turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
        {thinking && (
          <ThinkingIndicator thinking={thinking} elapsed={thinkingElapsed} phase={phase} />
        )}
        {sessionStatus === "completed" && (
          <SessionSummary
            phase={phase}
            branchName={branchName}
            prUrl={prUrl}
            prNumber={prNumber}
            turnsPath={turnsPath}
            artifactsPath={artifactsPath}
            artifactNames={artifactNames}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
