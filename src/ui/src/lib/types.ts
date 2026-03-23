export interface Turn {
  id: string
  turn: number
  from: "claude" | "codex" | "human" | "system"
  timestamp: string
  status: "complete" | "needs_human" | "done" | "decided" | "error"
  decisions: string[]
  content: string
}

export interface ThinkingState {
  agent: "claude" | "codex"
  since: string
}

export type SessionPhase = "debate" | "implement" | "review"

export interface TurnsResponse {
  turns: Turn[]
  session_status: "active" | "paused" | "completed"
  phase: SessionPhase
  topic: string
  turn_count: number
  thinking: ThinkingState | null
}
