export type CompletedCaptionSegment = {
  completedAt: string
  itemId: string
  language: 'auto' | 'en' | 'ja' | 'mixed' | 'und'
  lectureSessionId: string
  sequence: number
  startedAt: string
  text: string
}

export type CaptionWindow = {
  language: CompletedCaptionSegment['language']
  lastItemId: string
  sequence: number
  text: string
}

export function normalizeCaptionText(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function appendCompletedCaptionSegment(
  current: CompletedCaptionSegment[],
  segment: CompletedCaptionSegment,
) {
  const normalized = {
    ...segment,
    text: normalizeCaptionText(segment.text),
  }
  if (!normalized.text) return current

  const withoutDuplicate = current.filter(
    (item) => item.itemId !== normalized.itemId,
  )
  return [...withoutDuplicate, normalized].sort(
    (left, right) =>
      left.sequence - right.sequence || left.itemId.localeCompare(right.itemId),
  )
}

export function createCaptionWindow(
  segments: CompletedCaptionSegment[],
  nowMs = Date.now(),
  windowMs = 45_000,
  maxCharacters = 1_000,
): CaptionWindow | null {
  const recent = segments
    .filter((segment) => {
      const completedAt = Date.parse(segment.completedAt)
      return Number.isFinite(completedAt) && completedAt >= nowMs - windowMs
    })
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.itemId.localeCompare(right.itemId),
    )
  if (recent.length === 0) return null

  const selected: CompletedCaptionSegment[] = []
  let used = 0
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    const segment = recent[index]
    if (!segment) continue
    const available = maxCharacters - used - (selected.length > 0 ? 1 : 0)
    if (available <= 0) break
    const text = normalizeCaptionText(segment.text)
    if (!text) continue
    selected.unshift({ ...segment, text: text.slice(-available) })
    used += Math.min(text.length, available) + (selected.length > 1 ? 1 : 0)
  }

  const last = recent.at(-1)
  if (!last || selected.length === 0) return null
  const languages = new Set(selected.map((segment) => segment.language))
  return {
    language: languages.size === 1 ? selected[0]!.language : 'mixed',
    lastItemId: last.itemId,
    sequence: last.sequence,
    text: selected
      .map((segment) => segment.text)
      .join(' ')
      .slice(-maxCharacters),
  }
}
