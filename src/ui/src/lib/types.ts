export interface Turn {
  id: string
  turn: number
  from: "claude" | "codex" | "human" | "system"
  timestamp: string
  status: "complete" | "needs_human" | "done" | "error"
  decisions: string[]
  content: string
}

export interface ThinkingState {
  agent: "claude" | "codex"
  since: string
}

export interface TurnsResponse {
  turns: Turn[]
  session_status: "active" | "paused" | "completed"
  topic: string
  turn_count: number
  thinking: ThinkingState | null
}
