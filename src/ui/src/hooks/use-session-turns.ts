import { useState, useEffect, useRef, useCallback } from "react"
import { fetchSessionTurns } from "@/lib/api"
import type { Turn, ThinkingState, SessionPhase, PollingState, SessionSummary } from "@/lib/types"

const TURNS_POLL_INTERVAL = 3000
const ELAPSED_INTERVAL = 1000

export function elapsedStr(since: string): string {
  const secs = Math.round((Date.now() - new Date(since).getTime()) / 1000)
  if (secs < 60) return `${secs}s`
  return `${Math.floor(secs / 60)}m ${secs % 60}s`
}

export function formatDuration(ms: number): string {
  const totalSecs = Math.floor(ms / 1000)
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  if (h > 0) return `${h}h ${m}m ${s}s`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

function useLiveSessionTurns(sessionId: string, sessions: SessionSummary[], enabled = true): PollingState {
  const [turns, setTurns] = useState<Turn[]>([])
  const [sid, setSid] = useState("")
  const [sessionStatus, setSessionStatus] = useState<"active" | "paused" | "completed" | "interrupted">("active")
  const [topic, setTopic] = useState("")
  const [turnCount, setTurnCount] = useState(0)
  const [thinking, setThinking] = useState<ThinkingState | null>(null)
  const [thinkingElapsed, setThinkingElapsed] = useState("")
  const [statusText, setStatusText] = useState("Loading...")
  const [sessionTimer, setSessionTimer] = useState("0s")
  const [phase, setPhase] = useState<SessionPhase>("plan")
  const [branchName, setBranchName] = useState<string | null>(null)
  const [prUrl, setPrUrl] = useState<string | null>(null)
  const [prNumber, setPrNumber] = useState<number | null>(null)
  const [turnsPath, setTurnsPath] = useState<string | null>(null)
  const [artifactsPath, setArtifactsPath] = useState<string | null>(null)
  const [artifactNames, setArtifactNames] = useState<string[]>([])

  const turnsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const thinkingRef = useRef<ThinkingState | null>(null)
  const lastTurnCountRef = useRef(0)
  const sessionCreatedRef = useRef<string>("")
  const fetchingTurnsRef = useRef(false)
  const sessionIdRef = useRef(sessionId)
  // Track session_status from TurnsResponse for stop-polling decisions
  const lastSessionStatusRef = useRef<string>("active")

  // Keep sessionIdRef in sync
  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  // Reset state when sessionId changes
  useEffect(() => {
    setTurns([])
    setTurnCount(0)
    lastTurnCountRef.current = 0
    setThinking(null)
    thinkingRef.current = null
    setThinkingElapsed("")
    setStatusText("Loading...")
    lastSessionStatusRef.current = "active"
  }, [sessionId])

  const pollTurns = useCallback(async () => {
    const currentSid = sessionIdRef.current
    if (!currentSid || fetchingTurnsRef.current) return
    fetchingTurnsRef.current = true

    try {
      const data = await fetchSessionTurns(currentSid)

      // Discard if sessionId changed during fetch
      if (sessionIdRef.current !== currentSid) return

      if (data.session_id) setSid(data.session_id)
      if (data.topic) setTopic(data.topic)
      setTurnCount(data.turn_count)
      if (data.phase) setPhase(data.phase)
      setSessionStatus(data.session_status)
      lastSessionStatusRef.current = data.session_status

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
      const selectedSession = sessions.find(s => s.id === currentSid)
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
      // Stop polling based on TurnsResponse session_status (fresher than sessions prop)
      const isComplete = lastSessionStatusRef.current === "completed" || lastSessionStatusRef.current === "interrupted"
      if (!isComplete) {
        turnsTimeoutRef.current = setTimeout(pollTurns, TURNS_POLL_INTERVAL)
      }
    }
  }, [sessions])

  // Start turns polling
  useEffect(() => {
    if (!enabled || !sessionId) return
    pollTurns()
    return () => {
      if (turnsTimeoutRef.current) clearTimeout(turnsTimeoutRef.current)
    }
  }, [sessionId, pollTurns, enabled])

  // Elapsed time ticker
  useEffect(() => {
    if (!enabled) return
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
  }, [enabled])

  return {
    turns,
    sessionId: sid,
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

function useMockSessionTurns(sessionId: string, sessions: SessionSummary[]): PollingState {
  // Lazy-load mock data to avoid circular dependency issues
  const [mockData, setMockData] = useState<{ turns: Turn[], turn_count: number, artifact_names: string[] } | null>(null)

  useEffect(() => {
    import("@/mocks/mock-session").then(m => setMockData(m.MOCK_RESPONSE))
  }, [])

  const session = sessions.find(s => s.id === sessionId)
  const status = (session?.session_status ?? "completed") as PollingState["sessionStatus"]
  const statusText = status === "completed" ? "Session completed" : status === "paused" ? "Paused \u2014 waiting for human" : "Active"

  return {
    turns: sessionId === "mock-session-1" && mockData ? mockData.turns : [],
    sessionId,
    sessionStatus: status,
    topic: session?.topic ?? "",
    turnCount: sessionId === "mock-session-1" && mockData ? mockData.turn_count : (session?.current_turn ?? 0),
    thinking: status === "active" ? { agent: "claude", since: new Date(Date.now() - 15000).toISOString() } : null,
    thinkingElapsed: status === "active" ? "15s" : "",
    statusText,
    sessionTimer: "58m 0s",
    phase: (session?.phase ?? "review") as PollingState["phase"],
    branchName: session?.branch_name ?? null,
    prUrl: session?.pr_url ?? null,
    prNumber: sessionId === "mock-session-1" ? 42 : null,
    turnsPath: `.def/sessions/${sessionId}/turns`,
    artifactsPath: `.def/sessions/${sessionId}/artifacts`,
    artifactNames: sessionId === "mock-session-1" && mockData ? mockData.artifact_names : [],
  }
}

const isMock =
  import.meta.env.VITE_MOCK === "true" ||
  new URLSearchParams(window.location.search).has("mock")

export function useSessionTurns(sessionId: string, sessions: SessionSummary[]): PollingState {
  // Both hooks called unconditionally per React hook rules
  const live = useLiveSessionTurns(sessionId, sessions, !isMock)
  const mock = useMockSessionTurns(sessionId, sessions)
  return isMock ? mock : live
}
