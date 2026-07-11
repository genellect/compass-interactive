export const LIVE_SYNC_INTERVAL_MS = 5_000
export const BACKGROUND_LIVE_SYNC_INTERVAL_MS = 30_000
export const IDLE_SYNC_TIMEOUT_MS = 30 * 60 * 1000
export const HIDDEN_SYNC_STOP_MS = 10 * 60 * 1000
export const LIVE_SYNC_JITTER_MS = 1_000

export function getLiveSyncBackoffDelay({
  backgroundIntervalMs = BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  failureCount,
  foregroundIntervalMs = LIVE_SYNC_INTERVAL_MS,
}: {
  backgroundIntervalMs?: number
  failureCount: number
  foregroundIntervalMs?: number
}) {
  if (failureCount <= 0) {
    return foregroundIntervalMs
  }

  return Math.min(
    foregroundIntervalMs * 2 ** Math.min(failureCount, 3),
    backgroundIntervalMs,
  )
}

export function getLiveSyncJitter(randomValue = Math.random()) {
  return Math.round(Math.min(Math.max(randomValue, 0), 1) * LIVE_SYNC_JITTER_MS)
}

