import { useEffect } from 'react'
import {
  BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  LIVE_SYNC_INTERVAL_MS,
} from '../lib/liveSync'

type UseAdaptiveLiveSyncOptions = {
  backgroundIntervalMs?: number
  enabled: boolean
  foregroundIntervalMs?: number
  onSync: () => Promise<void> | void
  runImmediately?: boolean
}

function getCurrentInterval({
  backgroundIntervalMs,
  foregroundIntervalMs,
}: {
  backgroundIntervalMs: number
  foregroundIntervalMs: number
}) {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return backgroundIntervalMs
  }

  return foregroundIntervalMs
}

export function useAdaptiveLiveSync({
  backgroundIntervalMs = BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  enabled,
  foregroundIntervalMs = LIVE_SYNC_INTERVAL_MS,
  onSync,
  runImmediately = true,
}: UseAdaptiveLiveSyncOptions) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let disposed = false
    let running = false
    let timeoutId: number | null = null

    function clearScheduledSync() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    function scheduleNextSync(delay = getCurrentInterval({
      backgroundIntervalMs,
      foregroundIntervalMs,
    })) {
      if (disposed) {
        return
      }

      clearScheduledSync()
      timeoutId = window.setTimeout(() => {
        void runSync()
      }, delay)
    }

    async function runSync() {
      if (disposed || running) {
        return
      }

      running = true

      try {
        await onSync()
      } catch {
        // Keep the lightweight sync loop alive even when one request fails.
      } finally {
        running = false
        scheduleNextSync()
      }
    }

    function handleVisibilityChange() {
      clearScheduledSync()

      if (document.visibilityState === 'visible') {
        void runSync()
        return
      }

      scheduleNextSync(backgroundIntervalMs)
    }

    if (runImmediately) {
      void runSync()
    } else {
      scheduleNextSync()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      clearScheduledSync()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [backgroundIntervalMs, enabled, foregroundIntervalMs, onSync, runImmediately])
}
