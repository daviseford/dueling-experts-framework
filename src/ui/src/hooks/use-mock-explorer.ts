import { useState, useCallback } from "react"
import { MOCK_RESPONSE } from "@/mocks/mock-session"
import type { ExplorerState } from "./use-explorer"

const MOCK_SESSIONS = [
  {
    id: "mock-session-1",
    topic: "Add rate limiting middleware to the API gateway",
    created: "2026-03-24T14:00:00.000Z",
    session_status: "completed",
    phase: "review",
    current_turn: 11,
    mode: "edit",
    branch_name: "def/a1b2c3d4-rate-limiting-middleware",
    pr_url: "https://github.com/example/repo/pull/42",
    dir: ".def/sessions/mock-session-1",
    repo: "my-project",
  },
  {
    id: "mock-session-2",
    topic: "Refactor database connection pooling",
    created: "2026-03-24T10:00:00.000Z",
    session_status: "completed",
    phase: "implement",
    current_turn: 6,
    mode: "edit",
    branch_name: "def/b2c3d4e5-db-connection-pooling",
    pr_url: null,
    dir: ".def/sessions/mock-session-2",
    repo: "my-project",
  },
]

export function useMockExplorer(): ExplorerState {
  const [selectedSessionId, setSelectedSessionIdRaw] = useState("mock-session-1")

  const setSelectedSessionId = useCallback((id: string) => {
    setSelectedSessionIdRaw(id)
  }, [])

  return {
    sessions: MOCK_SESSIONS,
    selectedSessionId,
    setSelectedSessionId,
    owningSessionId: null,
    turns: selectedSessionId === "mock-session-1" ? MOCK_RESPONSE.turns : [],
    sessionId: selectedSessionId,
    sessionStatus: "completed",
    topic: MOCK_SESSIONS.find((s) => s.id === selectedSessionId)?.topic ?? "",
    turnCount: selectedSessionId === "mock-session-1" ? MOCK_RESPONSE.turn_count : 6,
    thinking: null,
    thinkingElapsed: "",
    statusText: "Session completed",
    sessionTimer: "58m 0s",
    phase: selectedSessionId === "mock-session-1" ? "review" : "implement",
    branchName: MOCK_SESSIONS.find((s) => s.id === selectedSessionId)?.branch_name ?? null,
    prUrl: MOCK_SESSIONS.find((s) => s.id === selectedSessionId)?.pr_url ?? null,
    prNumber: selectedSessionId === "mock-session-1" ? 42 : null,
    turnsPath: `.def/sessions/${selectedSessionId}/turns`,
    artifactsPath: `.def/sessions/${selectedSessionId}/artifacts`,
    artifactNames: selectedSessionId === "mock-session-1" ? MOCK_RESPONSE.artifact_names : [],
  }
}
