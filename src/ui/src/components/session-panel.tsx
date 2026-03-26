import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useSessionTurns } from "@/hooks/use-session-turns"
import { endSession } from "@/lib/api"
import { PauseBanner } from "@/components/pause-banner"
import { Transcript } from "@/components/transcript"
import { InterjectionInput } from "@/components/interjection-input"
import { StatusBar } from "@/components/status-bar"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Maximize2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PendingInterjection, SessionSummary } from "@/lib/types"

interface SessionPanelProps {
  sessionId: string
  sessions: SessionSummary[]
  showMaximize?: boolean
  showDismiss?: boolean
  showPanelHeader?: boolean
  className?: string
  onMaximize?: () => void
  onDismiss?: () => void
}

export function SessionPanel({
  sessionId,
  sessions,
  showMaximize,
  showDismiss,
  showPanelHeader,
  className,
  onMaximize,
  onDismiss,
}: SessionPanelProps) {
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
  } = useSessionTurns(sessionId, sessions)

  const isReadOnly = sessionStatus !== "active"
  const isCompleted = sessionStatus === "completed"
  const canDismiss = showDismiss && (sessionStatus === "completed" || sessionStatus === "interrupted")

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
      const topicPrefix = topic ? `${topic}: ` : ""
      toast.info(
        count === 1
          ? `${topicPrefix}Your queued message was not delivered — agents moved past the planning phase.`
          : `${topicPrefix}${count} queued messages were not delivered — agents moved past the planning phase.`
      )
    }
  }, [phase, visiblePending, topic])

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

  const handleEndSession = useCallback(async () => {
    await endSession(sessionId)
  }, [sessionId])

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden", showPanelHeader && "border border-border/30 rounded-lg", className)}>
      {showPanelHeader && (
        <div className="flex items-center gap-2 border-b border-border/30 bg-card/80 px-3 py-1.5">
          <span className="flex-1 truncate text-xs font-medium text-foreground/80">{topic || "Loading..."}</span>
          {!isReadOnly && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-destructive">
                  <span className="sr-only">End session</span>
                  <X className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>End this session?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will stop the session &ldquo;{topic}&rdquo;. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleEndSession}>End Session</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          {canDismiss && onDismiss && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-foreground" onClick={onDismiss} title="Dismiss">
              <span className="sr-only">Dismiss session</span>
              <X className="h-3 w-3" />
            </Button>
          )}
          {showMaximize && onMaximize && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground/50 hover:text-foreground" onClick={onMaximize} title="Maximize">
              <Maximize2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
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
      <InterjectionInput sessionId={sessionId} disabled={isCompleted} isReadOnly={isReadOnly} onSent={handleInterjectionSent} />
      <StatusBar
        statusText={statusText}
        turnCount={turnCount}
        sessionStatus={sessionStatus}
        sessionTimer={sessionTimer}
        allCollapsed={allCollapsed}
        onToggleAll={handleToggleAll}
      />
    </div>
  )
}
