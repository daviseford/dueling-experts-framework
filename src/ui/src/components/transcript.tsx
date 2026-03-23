import { useEffect, useRef } from "react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { TurnCard } from "./turn-card"
import { ThinkingIndicator } from "./thinking-indicator"
import type { Turn, ThinkingState } from "@/lib/types"

interface TranscriptProps {
  turns: Turn[]
  thinking: ThinkingState | null
  thinkingElapsed: string
}

export function Transcript({ turns, thinking, thinkingElapsed }: TranscriptProps) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const turnCount = turns.length
  const thinkingAgent = thinking?.agent ?? null

  // Only auto-scroll on new turns or thinking agent change (start/stop/switch)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" })
  }, [turnCount, thinkingAgent])

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="space-y-2 px-5 py-4">
        {turns.map((turn) => (
          <TurnCard key={turn.id} turn={turn} />
        ))}
        {thinking && (
          <ThinkingIndicator thinking={thinking} elapsed={thinkingElapsed} />
        )}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  )
}
