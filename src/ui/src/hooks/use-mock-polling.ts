import { MOCK_RESPONSE } from "@/mocks/mock-session"
import type { PollingState } from "@/lib/types"

export function useMockPolling(): PollingState {
  return {
    turns: MOCK_RESPONSE.turns,
    sessionStatus: MOCK_RESPONSE.session_status,
    topic: MOCK_RESPONSE.topic,
    turnCount: MOCK_RESPONSE.turn_count,
    thinking: null,
    thinkingElapsed: "",
    statusText: "Session completed",
    sessionTimer: "58m 0s",
    phase: MOCK_RESPONSE.phase,
    branchName: MOCK_RESPONSE.branch_name,
    prUrl: MOCK_RESPONSE.pr_url,
    prNumber: MOCK_RESPONSE.pr_number,
    turnsPath: MOCK_RESPONSE.turns_path,
    artifactsPath: MOCK_RESPONSE.artifacts_path,
    artifactNames: MOCK_RESPONSE.artifact_names,
  }
}
