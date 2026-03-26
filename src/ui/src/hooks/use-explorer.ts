import { useState, useEffect, useRef, useCallback } from "react"
import { fetchSessions } from "@/lib/api"
import { useMockSessionList } from "./use-mock-explorer"
import type { SessionListState, SessionSummary } from "@/lib/types"
import { isMock } from "@/lib/env"

const SESSIONS_POLL_INTERVAL = 5000

function useLiveSessionList(enabled = true): SessionListState {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState("")

  const sessionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fetchingSessionsRef = useRef(false)
  const selectedRef = useRef("")

  // Keep selectedRef in sync
  useEffect(() => {
    selectedRef.current = selectedSessionId
  }, [selectedSessionId])

  // Poll sessions list
  const pollSessions = useCallback(async () => {
    if (fetchingSessionsRef.current) return
    fetchingSessionsRef.current = true
    try {
      const data = await fetchSessions()
      setSessions(data.sessions)

      // Auto-select: prefer first active/paused, then first non-interrupted, then first session
      if (!selectedRef.current && data.sessions.length > 0) {
        const active = data.sessions.find(
          s => s.session_status === "active" || s.session_status === "paused"
        )
        const nonStale = active ?? data.sessions.find(s => s.session_status !== "interrupted")
        const pick = nonStale?.id ?? data.sessions[0].id

        setSelectedSessionId(pick)
        selectedRef.current = pick
      }
    } catch {
      // Silently retry
    } finally {
      fetchingSessionsRef.current = false
      sessionsTimeoutRef.current = setTimeout(pollSessions, SESSIONS_POLL_INTERVAL)
    }
  }, [])

  // Start sessions polling
  useEffect(() => {
    if (!enabled) return
    pollSessions()
    return () => {
      if (sessionsTimeoutRef.current) clearTimeout(sessionsTimeoutRef.current)
    }
  }, [pollSessions, enabled])

  return {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
  }
}

export function useSessionList(): SessionListState {
  // Both hooks called unconditionally per React hook rules
  const live = useLiveSessionList(!isMock)
  const mock = useMockSessionList()
  return isMock ? mock : live
}
