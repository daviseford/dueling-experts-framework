import { useEffect, useMemo, useRef } from "react"
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
  openMap: Record<string, boolean>
  onTurnOpenChange: (id: string, open: boolean) => void
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
  openMap,
  onTurnOpenChange,
}: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const turnCount = turns.length
  const thinkingAgent = thinking?.agent ?? null

  // Derive de-duplicated decisions from turns, preferring "decided" status turns
  const decisions = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    // First pass: decided turns (final consensus)
    for (const t of turns) {
      if (t.status === "decided" && t.decisions?.length) {
        for (const d of t.decisions) {
          if (!seen.has(d)) {
            seen.add(d)
            result.push(d)
          }
        }
      }
    }
    // Second pass: remaining turns with decisions (if no decided turns found)
    if (result.length === 0) {
      for (const t of turns) {
        if (t.decisions?.length) {
          for (const d of t.decisions) {
            if (!seen.has(d)) {
              seen.add(d)
              result.push(d)
            }
          }
        }
      }
    }
    return result
  }, [turns])

  // Only auto-scroll on new turns, thinking agent change, or session completion
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" })
  }, [turnCount, thinkingAgent, sessionStatus])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 px-5 py-4">
        {turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            open={openMap[turn.id] ?? true}
            onOpenChange={(open) => onTurnOpenChange(turn.id, open)}
          />
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
            decisions={decisions}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
