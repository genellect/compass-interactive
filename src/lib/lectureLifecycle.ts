import type { LiveComment } from '../types'

export type ServerClockSample = {
  receivedAtMonotonicMs: number
  serverTimeMs: number
}

export function createServerClockSample(
  serverTime: string,
  receivedAtMonotonicMs: number,
): ServerClockSample | null {
  const serverTimeMs = Date.parse(serverTime)
  if (!Number.isFinite(serverTimeMs)) {
    return null
  }

  return { receivedAtMonotonicMs, serverTimeMs }
}

export function estimateServerTimeMs(
  sample: ServerClockSample,
  monotonicNowMs: number,
) {
  return (
    sample.serverTimeMs +
    Math.max(monotonicNowMs - sample.receivedAtMonotonicMs, 0)
  )
}

export function getDeadlineRefreshDelayMs({
  hardStopAt,
  monotonicNowMs,
  sample,
}: {
  hardStopAt: string
  monotonicNowMs: number
  sample: ServerClockSample
}) {
  const hardStopTimeMs = Date.parse(hardStopAt)
  if (!Number.isFinite(hardStopTimeMs)) {
    return null
  }

  return Math.max(
    hardStopTimeMs - estimateServerTimeMs(sample, monotonicNowMs),
    0,
  )
}

export function removePendingComments(comments: LiveComment[]) {
  return comments.filter((comment) => !comment.isPending)
}

export function isLifecycleRequestCurrent(
  requestEpoch: number,
  currentEpoch: number,
) {
  return requestEpoch === currentEpoch
}
