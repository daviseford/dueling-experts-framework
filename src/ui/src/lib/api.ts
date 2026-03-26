import type { TurnsResponse, SessionsResponse } from "./types"

export async function fetchSessions(): Promise<SessionsResponse> {
  const res = await fetch("/api/sessions")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function fetchSessionTurns(sessionId: string): Promise<TurnsResponse> {
  const res = await fetch(`/api/sessions/${sessionId}/turns`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function sendInterjection(sessionId: string, content: string): Promise<void> {
  const res = await fetch("/api/interject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, content }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || "Failed to send")
  }
}

export async function endSession(sessionId: string): Promise<void> {
  await fetch("/api/end-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  })
}
