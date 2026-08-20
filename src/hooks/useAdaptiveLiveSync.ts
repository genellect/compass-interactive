import { useEffect } from 'react'
import {
  BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  getHiddenLiveSyncDelay,
  getLiveSyncBackoffDelay,
  getLiveSyncJitter,
  LIVE_SYNC_INTERVAL_MS,
  LIVE_SYNC_JITTER_MS,
} from '../lib/liveSync'

type UseAdaptiveLiveSyncOptions = {
  backgroundIntervalMs?: number
  enabled: boolean
  foregroundIntervalMs?: number
  initialJitterMs?: number
  jitterMs?: number
  onSync: () => Promise<void> | void
  runImmediately?: boolean
  visibilityJitterMs?: number
}

export function useAdaptiveLiveSync({
  backgroundIntervalMs = BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  enabled,
  foregroundIntervalMs = LIVE_SYNC_INTERVAL_MS,
  jitterMs = LIVE_SYNC_JITTER_MS,
  initialJitterMs = jitterMs,
  onSync,
  runImmediately = true,
  visibilityJitterMs = 0,
}: UseAdaptiveLiveSyncOptions) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    let disposed = false
    let failureCount = 0
    let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : null
    let hiddenSyncCompleted = false
    let running = false
    let timeoutId: number | null = null

    function clearScheduledSync() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
        timeoutId = null
      }
    }

    function scheduleSync(delay: number, countsAsHiddenSync: boolean) {
      if (disposed) {
        return
      }

      clearScheduledSync()
      timeoutId = window.setTimeout(() => {
        void runSync(countsAsHiddenSync)
      }, delay)
    }

    function scheduleHiddenSync() {
      const elapsedHiddenMs = hiddenSince ? Date.now() - hiddenSince : 0
      const delay = getHiddenLiveSyncDelay({
        backgroundIntervalMs,
        elapsedHiddenMs,
        hiddenSyncCompleted,
      })

      if (delay !== null) {
        scheduleSync(delay, true)
      }
    }

    function scheduleForegroundSync(syncStartedAt?: number) {
      const backoffDelay = getLiveSyncBackoffDelay({
        backgroundIntervalMs,
        failureCount,
        foregroundIntervalMs,
      })
      const completedRequestMs =
        failureCount === 0 && syncStartedAt
          ? Math.max(Date.now() - syncStartedAt, 0)
          : 0
      scheduleSync(
        Math.max(backoffDelay - completedRequestMs, 0) +
          getLiveSyncJitter(Math.random(), jitterMs),
        false,
      )
    }

    async function runSync(countsAsHiddenSync = false) {
      if (disposed || running) {
        return
      }

      running = true
      const syncStartedAt = Date.now()

      try {
        await onSync()
        failureCount = 0
      } catch {
        failureCount += 1
      } finally {
        running = false

        if (document.visibilityState === 'hidden') {
          if (countsAsHiddenSync) {
            hiddenSyncCompleted = true
          }
          scheduleHiddenSync()
        } else {
          scheduleForegroundSync(syncStartedAt)
        }
      }
    }

    function handleVisibilityChange() {
      clearScheduledSync()

      if (document.visibilityState === 'visible') {
        hiddenSince = null
        hiddenSyncCompleted = false
        scheduleSync(
          getLiveSyncJitter(Math.random(), visibilityJitterMs),
          false,
        )
        return
      }

      hiddenSince = Date.now()
      hiddenSyncCompleted = false
      scheduleHiddenSync()
    }

    if (document.visibilityState === 'hidden') {
      scheduleHiddenSync()
    } else if (runImmediately) {
      scheduleSync(getLiveSyncJitter(Math.random(), initialJitterMs), false)
    } else {
      scheduleSync(
        foregroundIntervalMs +
          getLiveSyncJitter(Math.random(), initialJitterMs),
        false,
      )
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      clearScheduledSync()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    backgroundIntervalMs,
    enabled,
    foregroundIntervalMs,
    initialJitterMs,
    jitterMs,
    onSync,
    runImmediately,
    visibilityJitterMs,
  ])
}
