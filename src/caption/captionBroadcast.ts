import type { CaptionContent } from '../components/LearningSupport'

export type CaptionBroadcastMessage = {
  caption: CaptionContent | null
  lectureSessionId: string
  source: 'completed' | 'delta' | 'stopped'
  timestamp: number
}

export function createCaptionBroadcastChannel(lectureSessionId: string) {
  if (typeof BroadcastChannel === 'undefined') return null
  return new BroadcastChannel(`compass-caption-${lectureSessionId}`)
}

export function isCaptionBroadcastMessage(
  value: unknown,
  lectureSessionId: string,
): value is CaptionBroadcastMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CaptionBroadcastMessage>
  return (
    message.lectureSessionId === lectureSessionId &&
    ['completed', 'delta', 'stopped'].includes(message.source ?? '') &&
    typeof message.timestamp === 'number' &&
    (message.caption === null ||
      (typeof message.caption === 'object' &&
        typeof message.caption.text === 'string'))
  )
}
