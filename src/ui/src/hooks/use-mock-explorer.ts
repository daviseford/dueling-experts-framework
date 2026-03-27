import { useState, useCallback, useMemo } from "react"
import { mockScenario } from "@/lib/env"
import type { SessionListState, SessionSummary } from "@/lib/types"

const DEFAULT_SESSIONS: SessionSummary[] = [
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
  {
    id: "mock-session-3",
    topic: "Implement WebSocket event streaming",
    created: "2026-03-25T09:00:00.000Z",
    session_status: "active",
    phase: "implement",
    current_turn: 4,
    mode: "edit",
    branch_name: "def/c3d4e5f6-websocket-streaming",
    pr_url: null,
    dir: ".def/sessions/mock-session-3",
    repo: "my-project",
  },
  {
    id: "mock-session-4",
    topic: "Fix authentication token refresh race condition",
    created: "2026-03-25T11:30:00.000Z",
    session_status: "paused",
    phase: "plan",
    current_turn: 2,
    mode: "edit",
    branch_name: null,
    pr_url: null,
    dir: ".def/sessions/mock-session-4",
    repo: "my-project",
  },
]

/** Scenario-specific session overrides */
function getScenarioSessions(): SessionSummary[] {
  switch (mockScenario) {
    case "empty":
      return [{
        id: "mock-session-empty",
        topic: "New session with no turns yet",
        created: new Date().toISOString(),
        session_status: "active",
        phase: "plan",
        current_turn: 0,
        mode: "edit",
        branch_name: null,
        pr_url: null,
        dir: ".def/sessions/mock-session-empty",
        repo: "my-project",
      }]
    case "loading":
      return [{
        id: "mock-session-loading",
        topic: "Session loading initial data",
        created: new Date().toISOString(),
        session_status: "active",
        phase: "plan",
        current_turn: 3,
        mode: "edit",
        branch_name: null,
        pr_url: null,
        dir: ".def/sessions/mock-session-loading",
        repo: "my-project",
      }]
    case "thinking":
      return [{
        id: "mock-session-thinking",
        topic: "Active session with agent thinking",
        created: new Date(Date.now() - 30 * 60_000).toISOString(),
        session_status: "active",
        phase: "implement",
        current_turn: 4,
        mode: "edit",
        branch_name: "def/thinking-test",
        pr_url: null,
        dir: ".def/sessions/mock-session-thinking",
        repo: "my-project",
      }]
    case "paused":
      return [{
        id: "mock-session-paused",
        topic: "Paused session waiting for human input",
        created: new Date(Date.now() - 20 * 60_000).toISOString(),
        session_status: "paused",
        phase: "plan",
        current_turn: 2,
        mode: "edit",
        branch_name: null,
        pr_url: null,
        dir: ".def/sessions/mock-session-paused",
        repo: "my-project",
      }]
    default:
      return DEFAULT_SESSIONS
  }
}

export function useMockSessionList(): SessionListState {
  // Memoize so we return the same array reference across renders
  const scenarioSessions = useMemo(() => getScenarioSessions(), [])
  const [selectedSessionId, setSelectedSessionIdRaw] = useState(scenarioSessions[0].id)

  const setSelectedSessionId = useCallback((id: string) => {
    setSelectedSessionIdRaw(id)
  }, [])

  return {
    sessions: scenarioSessions,
    selectedSessionId,
    setSelectedSessionId,
  }
}
