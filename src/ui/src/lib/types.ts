export interface Turn {
  id: string
  turn: number
  from: "claude" | "codex" | "human" | "system"
  timestamp: string
  status: "complete" | "needs_human" | "done" | "decided" | "error"
  phase: "plan" | "debate" | "implement" | "review"
  verdict?: "approve" | "fix"
  duration_ms?: number
  decisions: string[]
  content: string
  model_tier?: "full" | "fast"
}

export interface ThinkingState {
  agent: "claude" | "codex"
  since: string
}

export type SessionPhase = "plan" | "debate" | "implement" | "review"

export interface TurnsResponse {
  turns: Turn[]
  session_status: "active" | "paused" | "completed" | "interrupted"
  phase: SessionPhase
  topic: string
  turn_count: number
  thinking: ThinkingState | null
  branch_name: string | null
  pr_url: string | null
  pr_number: number | null
  turns_path: string | null
  artifacts_path: string | null
  artifact_names: string[]
}

export interface PollingState {
  turns: Turn[]
  sessionStatus: "active" | "paused" | "completed" | "interrupted"
  topic: string
  turnCount: number
  thinking: ThinkingState | null
  thinkingElapsed: string
  statusText: string
  sessionTimer: string
  phase: SessionPhase
  branchName: string | null
  prUrl: string | null
  prNumber: number | null
  turnsPath: string | null
  artifactsPath: string | null
  artifactNames: string[]
}
