import { useEffect, useMemo, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TurnCard } from "./turn-card"
import { PendingTurnCard } from "./pending-turn-card"
import { ThinkingIndicator } from "./thinking-indicator"
import { SessionSummary } from "./session-summary"
import { PhaseDivider } from "./phase-divider"
import { CheckCircle2 } from "lucide-react"
import type { Turn, ThinkingState, SessionPhase, PendingInterjection } from "@/lib/types"

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
  pendingInterjections: PendingInterjection[]
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
  pendingInterjections,
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

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-3 px-5 py-4">
        {turns.map((turn, i) => {
          const prevPhase = i > 0 ? turns[i - 1].phase : null
          const showDivider = prevPhase !== null && turn.phase !== prevPhase
          return (
            <div key={turn.id}>
              {showDivider && <PhaseDivider phase={turn.phase} />}
              <TurnCard
                turn={turn}
                open={openMap[turn.id] ?? true}
                onOpenChange={(open) => onTurnOpenChange(turn.id, open)}
              />
            </div>
          )
        })}
        {pendingInterjections.map((p) => (
          <PendingTurnCard key={p.id} content={p.content} />
        ))}
        {sessionStatus !== "completed" && decisions.length > 0 && (
          <div className="rounded-lg border border-border/30 bg-card/60 px-4 py-3">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-teal-500" />
              <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground/70">
                Decisions so far ({decisions.length})
              </span>
            </div>
            <ul className="space-y-1">
              {decisions.map((d, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-foreground/75">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-teal-500/60" />
                  {d}
                </li>
              ))}
            </ul>
          </div>
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
            decisions={decisions}
            implementations={implementations}
          />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
