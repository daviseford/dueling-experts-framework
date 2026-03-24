import { usePolling } from "./use-polling"
import { useMockPolling } from "./use-mock-polling"
import type { PollingState } from "@/lib/types"

const isMock = new URLSearchParams(window.location.search).has("mock")

export function useSessionData(): PollingState {
  const live = usePolling({ enabled: !isMock })
  const mock = useMockPolling()
  return isMock ? mock : live
}
