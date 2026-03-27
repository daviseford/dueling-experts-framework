export interface Turn {
  id: string
  turn: number
  from: "claude" | "codex" | "human" | "system" | (string & {})
  timestamp: string
  status: "complete" | "needs_human" | "done" | "decided" | "error"
  phase: "plan" | "debate" | "implement" | "review"
  verdict?: "approve" | "fix"
  duration_ms?: number
  decisions: string[]
  content: string
  model_tier?: "full" | "mid" | "fast"
  model_name?: string
  tokens_in?: number | null
  tokens_out?: number | null
  cost_usd?: number | null
}

export interface ThinkingState {
  agent: "claude" | "codex" | (string & {})
  since: string
  model?: string | null
}

export type SessionPhase = "plan" | "debate" | "implement" | "review"

export interface UsageTotals {
  tokens_in: number
  tokens_out: number
  cost_usd: number
  duration_ms: number
}

export interface TurnsResponse {
  turns: Turn[]
  session_id: string
  session_status: SessionStatus
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
  usage: UsageTotals | null
}

export interface PendingInterjection {
  id: string
  content: string
}

export type SessionStatus = "active" | "paused" | "completed" | "interrupted"

export interface SessionSummary {
  id: string
  topic: string
  created: string
  session_status: SessionStatus
  phase: SessionPhase
  current_turn: number
  mode: string
  branch_name: string | null
  pr_url: string | null
  dir: string
  repo: string
}

export interface SessionsResponse {
  sessions: SessionSummary[]
  owning_session_id: string | null
}

export type ViewMode = "single" | "grid"

export interface SessionListState {
  sessions: SessionSummary[]
  selectedSessionId: string
  setSelectedSessionId: (id: string) => void
}

export interface PollingState {
  turns: Turn[]
  sessionId: string
  sessionStatus: SessionStatus
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
  usage: UsageTotals | null
}
