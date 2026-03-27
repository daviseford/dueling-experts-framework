import { useEffect, useMemo, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TurnCard } from "./turn-card"
import { PendingTurnCard } from "./pending-turn-card"
import { ThinkingIndicator } from "./thinking-indicator"
import { SessionSummary } from "./session-summary"
import { DecisionLog } from "./decision-log"
import { SkeletonTurnCard } from "./skeleton-turn-card"
import { MessageSquare } from "lucide-react"
import type { Turn, ThinkingState, SessionPhase, PendingInterjection } from "@/lib/types"

interface DecisionEntry {
  text: string
  from: Turn["from"]
  turn: number
}

interface TranscriptProps {
  turns: Turn[]
  thinking: ThinkingState | null
  thinkingElapsed: string
  phase: SessionPhase
  sessionStatus: "active" | "paused" | "completed" | "interrupted"
  statusText: string
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  openMap: Record<string, boolean>
  onTurnOpenChange: (id: string, open: boolean) => void
  pendingInterjections: PendingInterjection[]
}

export function Transcript({
  turns,
  thinking,
  thinkingElapsed,
  phase,
  sessionStatus,
  statusText,
  branchName,
  prUrl,
  prNumber,
  turnsPath,
  artifactsPath,
  openMap,
  onTurnOpenChange,
  pendingInterjections,
}: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const turnCount = turns.length
  const thinkingAgent = thinking?.agent ?? null

  // Derive de-duplicated decisions with attribution from turns, preferring "decided" status turns
  const decisionEntries = useMemo(() => {
    const seen = new Set<string>()
    const result: DecisionEntry[] = []
    // First pass: decided turns (final consensus)
    for (const t of turns) {
      if (t.status === "decided" && t.decisions?.length) {
        for (const d of t.decisions) {
          if (!seen.has(d)) {
            seen.add(d)
            result.push({ text: d, from: t.from, turn: t.turn })
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
              result.push({ text: d, from: t.from, turn: t.turn })
            }
          }
        }
      }
    }
    return result
  }, [turns])

  const summaryDecisions = useMemo(
    () => decisionEntries.map((d) => d.text),
    [decisionEntries]
  )

  // Extract implementation summaries from implement-phase turns
  const implementations = useMemo(() => {
    return turns
      .filter((t) => t.phase === "implement" && t.status !== "error" && t.content)
      .map((t) => {
        // Take the first non-empty, non-heading, non-fence line as a summary
        const lines = t.content.split(/\r?\n/)
        const bullets: string[] = []
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith("---") || trimmed.startsWith("```") || trimmed.startsWith("#")) continue
          // Collect bullet points or first paragraph lines
          if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
            bullets.push(trimmed.replace(/^[-*]\s+/, ""))
          } else if (bullets.length === 0) {
            bullets.push(trimmed)
          }
          if (bullets.length >= 5) break
        }
        return bullets
      })
      .flat()
      .slice(0, 8)
  }, [turns])

  const pendingCount = pendingInterjections.length

  // Only auto-scroll on new turns, thinking agent change, session completion, or new pending
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" })
  }, [turnCount, thinkingAgent, sessionStatus, pendingCount])

  const isLoading = turns.length === 0 && statusText === "Loading..."
  const isEmpty = turns.length === 0 && !isLoading && !thinking && (sessionStatus === "active" || sessionStatus === "paused")

  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div className="min-w-0 space-y-3 overflow-hidden px-5 py-4">
        {isLoading && (
          <>
            <SkeletonTurnCard index={0} />
            <SkeletonTurnCard index={1} />
            <SkeletonTurnCard index={2} />
          </>
        )}
        {isEmpty && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <MessageSquare className="h-8 w-8 text-muted-foreground/30" aria-hidden="true" />
            <p className="text-sm text-muted-foreground/60">Waiting for agents to start...</p>
          </div>
        )}
        {turns.map((turn) => (
          <TurnCard
            key={turn.id}
            turn={turn}
            open={openMap[turn.id] ?? true}
            onOpenChange={(open) => onTurnOpenChange(turn.id, open)}
          />
        ))}
        {pendingInterjections.map((p) => (
          <PendingTurnCard key={p.id} content={p.content} />
        ))}
        {sessionStatus !== "completed" && decisionEntries.length > 0 && (
          <DecisionLog entries={decisionEntries} phase={phase} />
        )}
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
            decisions={summaryDecisions}
            implementations={implementations}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
