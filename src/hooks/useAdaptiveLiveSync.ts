import { useEffect } from 'react'
import {
  BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  getLiveSyncBackoffDelay,
  getLiveSyncJitter,
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
    let failureCount = 0
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
        failureCount = 0
      } catch {
        failureCount += 1
      } finally {
        running = false
        scheduleNextSync(
          document.visibilityState === 'hidden'
            ? backgroundIntervalMs
            : getLiveSyncBackoffDelay({
                backgroundIntervalMs,
                failureCount,
                foregroundIntervalMs,
              }),
        )
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
      scheduleNextSync(getLiveSyncJitter())
    } else {
      scheduleNextSync(getCurrentInterval({
        backgroundIntervalMs,
        foregroundIntervalMs,
      }) + getLiveSyncJitter())
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      clearScheduledSync()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [backgroundIntervalMs, enabled, foregroundIntervalMs, onSync, runImmediately])
}
