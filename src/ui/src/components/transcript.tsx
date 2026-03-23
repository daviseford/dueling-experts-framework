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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "instant" })
  }, [turns, thinking, thinkingElapsed])

  return (
    <ScrollArea className="flex-1">
      <div className="space-y-4 p-5">
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
