export const LIVE_SYNC_INTERVAL_MS = 5_000
export const DISPLAY_LIVE_SYNC_INTERVAL_MS = 5_000
export const DISPLAY_LIVE_SYNC_INITIAL_JITTER_MS = 0
export const DISPLAY_LIVE_SYNC_JITTER_MS = 0
export const STUDENT_LIVE_SYNC_INTERVAL_MS = 5_000
export const STUDENT_LIVE_SYNC_INITIAL_JITTER_MS = 5_000
export const STUDENT_LIVE_SYNC_JITTER_MS = 0
export const BACKGROUND_LIVE_SYNC_INTERVAL_MS = 30_000
export const HIDDEN_SYNC_STOP_MS = 60_000
export const LIVE_SYNC_JITTER_MS = 1_000

export function getLiveSyncRouteOptions(pathname: string) {
  if (pathname === '/lecture') {
    return {
      foregroundIntervalMs: STUDENT_LIVE_SYNC_INTERVAL_MS,
      initialJitterMs: STUDENT_LIVE_SYNC_INITIAL_JITTER_MS,
      jitterMs: STUDENT_LIVE_SYNC_JITTER_MS,
      runImmediately: true,
      visibilityJitterMs: STUDENT_LIVE_SYNC_INITIAL_JITTER_MS,
    }
  }
  if (pathname === '/display') {
    return {
      foregroundIntervalMs: DISPLAY_LIVE_SYNC_INTERVAL_MS,
      initialJitterMs: DISPLAY_LIVE_SYNC_INITIAL_JITTER_MS,
      jitterMs: DISPLAY_LIVE_SYNC_JITTER_MS,
    }
  }
  return {}
}

export function normalizeLiveSyncPathname(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '')
  return normalized || '/'
}

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

export function getLiveSyncJitter(
  randomValue = Math.random(),
  jitterMs = LIVE_SYNC_JITTER_MS,
) {
  return Math.round(Math.min(Math.max(randomValue, 0), 1) * jitterMs)
}

export function getHiddenLiveSyncDelay({
  backgroundIntervalMs = BACKGROUND_LIVE_SYNC_INTERVAL_MS,
  elapsedHiddenMs,
  hiddenSyncCompleted,
  stopAfterMs = HIDDEN_SYNC_STOP_MS,
}: {
  backgroundIntervalMs?: number
  elapsedHiddenMs: number
  hiddenSyncCompleted: boolean
  stopAfterMs?: number
}) {
  if (hiddenSyncCompleted || elapsedHiddenMs >= stopAfterMs) {
    return null
  }

  return Math.max(backgroundIntervalMs - elapsedHiddenMs, 0)
}
