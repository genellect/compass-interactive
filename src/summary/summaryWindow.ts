import type { CompletedCaptionSegment } from '../caption/captionWindow'

export const SUMMARY_WINDOW_MS = 5 * 60 * 1_000
export const SUMMARY_WINDOW_LIMIT = 18

export type DueSummaryWindow = {
  endAt: string
  index: number
  startAt: string
}

export type SummaryScheduleStatus = {
  due: boolean
  nextWindow: DueSummaryWindow | null
}

export function getSummaryScheduleStatus(input: {
  hardStopAt: string
  processedWindowIndexes: ReadonlySet<number>
  serverNow: string
  startedAt: string
}): SummaryScheduleStatus {
  const startedMs = Date.parse(input.startedAt)
  const hardStopMs = Date.parse(input.hardStopAt)
  const nowMs = Date.parse(input.serverNow)
  if (
    !Number.isFinite(startedMs) ||
    !Number.isFinite(hardStopMs) ||
    !Number.isFinite(nowMs) ||
    hardStopMs <= startedMs
  ) {
    return { due: false, nextWindow: null }
  }

  for (let index = 1; index <= SUMMARY_WINDOW_LIMIT; index += 1) {
    const startMs = startedMs + (index - 1) * SUMMARY_WINDOW_MS
    const endMs = startMs + SUMMARY_WINDOW_MS
    if (startMs >= hardStopMs) break
    if (!input.processedWindowIndexes.has(index)) {
      return {
        due: endMs <= nowMs,
        nextWindow: {
          endAt: new Date(endMs).toISOString(),
          index,
          startAt: new Date(startMs).toISOString(),
        },
      }
    }
  }

  return { due: false, nextWindow: null }
}

export function getDueSummaryWindows(input: {
  hardStopAt: string
  processedWindowIndexes: ReadonlySet<number>
  serverNow: string
  startedAt: string
}) {
  const startedMs = Date.parse(input.startedAt)
  const hardStopMs = Date.parse(input.hardStopAt)
  const nowMs = Date.parse(input.serverNow)
  if (
    !Number.isFinite(startedMs) ||
    !Number.isFinite(hardStopMs) ||
    !Number.isFinite(nowMs) ||
    hardStopMs <= startedMs
  ) {
    return []
  }

  const windows: DueSummaryWindow[] = []
  for (let index = 1; index <= SUMMARY_WINDOW_LIMIT; index += 1) {
    const startMs = startedMs + (index - 1) * SUMMARY_WINDOW_MS
    const endMs = startMs + SUMMARY_WINDOW_MS
    if (startMs >= hardStopMs || endMs > nowMs) break
    if (!input.processedWindowIndexes.has(index)) {
      windows.push({
        endAt: new Date(endMs).toISOString(),
        index,
        startAt: new Date(startMs).toISOString(),
      })
    }
  }
  return windows
}

export function selectSummaryWindowSegments(
  segments: CompletedCaptionSegment[],
  window: DueSummaryWindow,
) {
  const startMs = Date.parse(window.startAt)
  const endMs = Date.parse(window.endAt)
  return segments
    .filter((segment) => {
      const completedMs = Date.parse(segment.completedAt)
      return (
        Number.isFinite(completedMs) &&
        completedMs >= startMs &&
        completedMs < endMs
      )
    })
    .sort(
      (left, right) =>
        Date.parse(left.completedAt) - Date.parse(right.completedAt) ||
        left.sequence - right.sequence,
    )
}

export function formatSummaryWindowLabel(startAt: string, endAt: string) {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${formatter.format(new Date(startAt))}–${formatter.format(new Date(endAt))}`
}
