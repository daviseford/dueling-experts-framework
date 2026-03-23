import { useState, useEffect, useRef, useCallback } from "react"
import { fetchTurns } from "@/lib/api"
import type { Turn, ThinkingState } from "@/lib/types"

interface PollingState {
  turns: Turn[]
  sessionStatus: "active" | "paused" | "completed"
  topic: string
  turnCount: number
  thinking: ThinkingState | null
  thinkingElapsed: string
  statusText: string
}

const POLL_INTERVAL = 3000
const ELAPSED_INTERVAL = 1000

function elapsedStr(since: string): string {
  const secs = Math.round((Date.now() - new Date(since).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function usePolling(): PollingState {
  const [turns, setTurns] = useState<Turn[]>([])
  const [sessionStatus, setSessionStatus] = useState<"active" | "paused" | "completed">("active")
  const [topic, setTopic] = useState("")
  const [turnCount, setTurnCount] = useState(0)
  const [thinking, setThinking] = useState<ThinkingState | null>(null)
  const [thinkingElapsed, setThinkingElapsed] = useState("")
  const [statusText, setStatusText] = useState("Connecting...")

  const fetchInFlightRef = useRef(false)
  const lastTurnCountRef = useRef(0)
  const pollingStoppedRef = useRef(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const thinkingRef = useRef<ThinkingState | null>(null)

  const poll = useCallback(async () => {
    if (fetchInFlightRef.current || pollingStoppedRef.current) return
    fetchInFlightRef.current = true

    try {
      const data = await fetchTurns()

      // Discard stale responses
      if (data.turn_count < lastTurnCountRef.current) {
        return
      }

      // Always update status/topic
      if (data.topic) setTopic(data.topic)
      setTurnCount(data.turn_count)

      const newStatus = data.session_status
      setSessionStatus(newStatus)

      if (newStatus === "completed") {
        setStatusText("Session completed")
      } else if (newStatus === "paused") {
        setStatusText("Paused \u2014 waiting for human")
      } else {
        setStatusText("Active")
      }

      // Update thinking state
      setThinking(data.thinking)
      thinkingRef.current = data.thinking
      if (data.thinking) {
        setThinkingElapsed(elapsedStr(data.thinking.since))
      } else {
        setThinkingElapsed("")
      }

      // Re-render turns only when turn count changes or session completed
      if (data.turn_count !== lastTurnCountRef.current || newStatus === "completed") {
        lastTurnCountRef.current = data.turn_count
        setTurns(data.turns)
      }

      // Stop polling when completed
      if (newStatus === "completed") {
        pollingStoppedRef.current = true
        return
      }
    } catch (err) {
      if (!pollingStoppedRef.current) {
        setStatusText(`Connection error: ${err instanceof Error ? err.message : "Unknown"}`)
      }
    } finally {
      fetchInFlightRef.current = false
      if (!pollingStoppedRef.current) {
        timeoutRef.current = setTimeout(poll, POLL_INTERVAL)
      }
    }
  }, [])

  // Main polling loop
  useEffect(() => {
    poll()
    return () => {
      pollingStoppedRef.current = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
    }
  }, [poll])

  // Elapsed time ticker for thinking indicator
  useEffect(() => {
    elapsedIntervalRef.current = setInterval(() => {
      const t = thinkingRef.current
      if (t) {
        setThinkingElapsed(elapsedStr(t.since))
      }
    }, ELAPSED_INTERVAL)

    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [])

  return { turns, sessionStatus, topic, turnCount, thinking, thinkingElapsed, statusText }
}
