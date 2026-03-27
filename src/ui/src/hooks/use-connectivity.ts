import { useState, useEffect, useRef, useCallback } from "react"
import { isMock } from "@/lib/env"
import { fetchSessions } from "@/lib/api"

const PROBE_INTERVAL = 3000
const FAILURE_THRESHOLD = 2

/**
 * Dedicated connectivity probe that polls GET /api/sessions to detect
 * whether the backend server is reachable. Reuses the existing fetchSessions()
 * path. Decoupled from data-fetching hooks so it works even when no session
 * is selected.
 */
export function useConnectivity(): { connected: boolean } {
  const [connected, setConnected] = useState(true)
  const failCountRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const probingRef = useRef(false)

  const probe = useCallback(async () => {
    if (probingRef.current) return
    probingRef.current = true
    try {
      await fetchSessions()
      failCountRef.current = 0
      setConnected(true)
    } catch {
      failCountRef.current++
      if (failCountRef.current >= FAILURE_THRESHOLD) {
        setConnected(false)
      }
    } finally {
      probingRef.current = false
      timerRef.current = setTimeout(probe, PROBE_INTERVAL)
    }
  }, [])

  useEffect(() => {
    if (isMock) return
    probe()
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [probe])

  // In mock mode, always report connected
  if (isMock) return { connected: true }

  return { connected }
}
