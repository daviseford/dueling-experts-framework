import { useState, useEffect, useRef } from "react"
import { isMock } from "@/lib/env"

const PROBE_INTERVAL = 3000
const PROBE_TIMEOUT = 5000
const FAILURE_THRESHOLD = 2

/**
 * Dedicated connectivity probe that polls GET /api/sessions to detect
 * whether the backend server is reachable. Decoupled from data-fetching
 * hooks so it works even when no session is selected.
 *
 * Uses AbortController for both unmount cleanup and per-request timeout
 * to prevent hung fetches from blocking the probe chain.
 */
export function useConnectivity(): { connected: boolean } {
  const [connected, setConnected] = useState(true)
  const failCountRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    if (isMock) return
    mountedRef.current = true

    async function probe() {
      try {
        const res = await fetch("/api/sessions", {
          signal: AbortSignal.timeout(PROBE_TIMEOUT),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        failCountRef.current = 0
        if (mountedRef.current) setConnected(true)
      } catch {
        failCountRef.current++
        if (failCountRef.current >= FAILURE_THRESHOLD && mountedRef.current) {
          setConnected(false)
        }
      } finally {
        if (mountedRef.current) {
          timerRef.current = setTimeout(probe, PROBE_INTERVAL)
        }
      }
    }

    probe()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  // In mock mode, always report connected
  if (isMock) return { connected: true }

  return { connected }
}
