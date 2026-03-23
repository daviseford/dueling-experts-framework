import type { TurnsResponse } from "./types"

export async function fetchTurns(): Promise<TurnsResponse> {
  const res = await fetch("/api/turns")
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export async function sendInterjection(content: string): Promise<void> {
  const res = await fetch("/api/interject", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || "Failed to send")
  }
}

export async function endSession(): Promise<void> {
  await fetch("/api/end-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
}
