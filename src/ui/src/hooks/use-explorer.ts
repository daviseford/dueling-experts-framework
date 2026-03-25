import { useState, useEffect, useRef, useCallback } from "react"
import { fetchSessions, fetchSessionTurns } from "@/lib/api"
import { useMockExplorer } from "./use-mock-explorer"
import type { Turn, ThinkingState, SessionPhase, PollingState, SessionSummary } from "@/lib/types"

const SESSIONS_POLL_INTERVAL = 5000
const TURNS_POLL_INTERVAL = 3000
const ELAPSED_INTERVAL = 1000

function elapsedStr(since: string): string {
  const secs = Math.round((Date.now() - new Date(since).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export interface ExplorerState extends PollingState {
  sessions: SessionSummary[]
  selectedSessionId: string
  setSelectedSessionId: (id: string) => void
  owningSessionId: string | null
}

function useLiveExplorer(enabled = true): ExplorerState {
  // Session list
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [owningSessionId, setOwningSessionId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionIdRaw] = useState("")

  // Turn data for selected session
  const [turns, setTurns] = useState<Turn[]>([])
  const [sessionId, setSessionId] = useState("")
  const [sessionStatus, setSessionStatus] = useState<"active" | "paused" | "completed" | "interrupted">("active")
  const [topic, setTopic] = useState("")
  const [turnCount, setTurnCount] = useState(0)
  const [thinking, setThinking] = useState<ThinkingState | null>(null)
  const [thinkingElapsed, setThinkingElapsed] = useState("")
  const [statusText, setStatusText] = useState("Connecting...")
  const [sessionTimer, setSessionTimer] = useState("0s")
  const [phase, setPhase] = useState<SessionPhase>("plan")
  const [branchName, setBranchName] = useState<string | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [prNumber, setPrNumber] = useState<number | null>(null)
  const [turnsPath, setTurnsPath] = useState<string | null>(null)
  const [artifactsPath, setArtifactsPath] = useState<string | null>(null)
  const [artifactNames, setArtifactNames] = useState<string[]>([])

  const sessionsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const turnsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const thinkingRef = useRef<ThinkingState | null>(null)
  const lastTurnCountRef = useRef(0)
  const sessionCreatedRef = useRef<string>("")
  const fetchingSessionsRef = useRef(false)
  const fetchingTurnsRef = useRef(false)
  const selectedRef = useRef("")

  // Keep selectedRef in sync
  useEffect(() => {
    selectedRef.current = selectedSessionId
  }, [selectedSessionId])

  // Session ID setter that resets turn state
  const setSelectedSessionId = useCallback((id: string) => {
    setSelectedSessionIdRaw(id)
    setTurns([])
    setTurnCount(0)
    lastTurnCountRef.current = 0
    setThinking(null)
    thinkingRef.current = null
    setThinkingElapsed("")
    setStatusText("Loading...")
  }, [])

  // Poll sessions list
  const pollSessions = useCallback(async () => {
    if (fetchingSessionsRef.current) return
    fetchingSessionsRef.current = true
    try {
      const data = await fetchSessions()
      setSessions(data.sessions)
      setOwningSessionId(data.owning_session_id)

      // Auto-select owning session on first load
      if (!selectedRef.current && data.owning_session_id) {
        setSelectedSessionIdRaw(data.owning_session_id)
        selectedRef.current = data.owning_session_id
      } else if (!selectedRef.current && data.sessions.length > 0) {
        setSelectedSessionIdRaw(data.sessions[0].id)
        selectedRef.current = data.sessions[0].id
      }
    } catch {
      // Silently retry
    } finally {
      fetchingSessionsRef.current = false
      sessionsTimeoutRef.current = setTimeout(pollSessions, SESSIONS_POLL_INTERVAL)
    }
  }, [])

  // Poll turns for selected session
  const pollTurns = useCallback(async () => {
    const sid = selectedRef.current
    if (!sid || fetchingTurnsRef.current) return
    fetchingTurnsRef.current = true

    try {
      const data = await fetchSessionTurns(sid)

      // Discard if selection changed during fetch
      if (selectedRef.current !== sid) return

      if (data.session_id) setSessionId(data.session_id)
      if (data.topic) setTopic(data.topic)
      setTurnCount(data.turn_count)
      if (data.phase) setPhase(data.phase)
      setSessionStatus(data.session_status)

      if (data.session_status === "completed") {
        setStatusText("Session completed")
      } else if (data.session_status === "paused") {
        setStatusText("Paused \u2014 waiting for human")
      } else {
        setStatusText("Active")
      }

      setBranchName(data.branch_name ?? null)
      setPrUrl(data.pr_url ?? null)
      setPrNumber(data.pr_number ?? null)
      setTurnsPath(data.turns_path ?? null)
      setArtifactsPath(data.artifacts_path ?? null)
      setArtifactNames(data.artifact_names ?? [])

      setThinking(data.thinking)
      thinkingRef.current = data.thinking
      if (data.thinking) {
        setThinkingElapsed(elapsedStr(data.thinking.since))
      } else {
        setThinkingElapsed("")
      }

      // Track session created time for timer
      const selectedSession = sessions.find(s => s.id === sid)
      if (selectedSession?.created) {
        sessionCreatedRef.current = selectedSession.created
      }

      if (data.turn_count !== lastTurnCountRef.current || data.session_status === "completed") {
        lastTurnCountRef.current = data.turn_count
        setTurns(data.turns)
      }
    } catch {
      // Silently retry
    } finally {
      fetchingTurnsRef.current = false
      // Don't poll completed sessions
      const current = sessions.find(s => s.id === selectedRef.current)
      const isComplete = current?.session_status === "completed" || current?.session_status === "interrupted"
      if (!isComplete) {
        turnsTimeoutRef.current = setTimeout(pollTurns, TURNS_POLL_INTERVAL)
      }
    }
  }, [sessions])

  // Start sessions polling
  useEffect(() => {
    if (!enabled) return
    pollSessions()
    return () => {
      if (sessionsTimeoutRef.current) clearTimeout(sessionsTimeoutRef.current)
    }
  }, [pollSessions, enabled])

  // Start turns polling when selection changes
  useEffect(() => {
    if (!enabled || !selectedSessionId) return
    pollTurns()
    return () => {
      if (turnsTimeoutRef.current) clearTimeout(turnsTimeoutRef.current)
    }
  }, [selectedSessionId, pollTurns, enabled])

  // Elapsed time ticker
  useEffect(() => {
    elapsedIntervalRef.current = setInterval(() => {
      const t = thinkingRef.current
      if (t) {
        setThinkingElapsed(elapsedStr(t.since))
      }
      if (sessionCreatedRef.current) {
        setSessionTimer(formatDuration(Date.now() - new Date(sessionCreatedRef.current).getTime()))
      }
    }, ELAPSED_INTERVAL)

    return () => {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current)
    }
  }, [])

  return {
    sessions,
    selectedSessionId,
    setSelectedSessionId,
    owningSessionId,
    turns,
    sessionId,
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
    artifactNames,
  }
}

const isMock =
  import.meta.env.VITE_MOCK === "true" ||
  new URLSearchParams(window.location.search).has("mock")

export function useExplorer(): ExplorerState {
  // Both hooks must be called unconditionally (rules of hooks).
  // useLiveExplorer skips fetches when mock mode is active via the enabled guard below,
  // so there are no wasted network requests.
  const live = useLiveExplorer(!isMock)
  const mock = useMockExplorer()
  return isMock ? mock : live
}
