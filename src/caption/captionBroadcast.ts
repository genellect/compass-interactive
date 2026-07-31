import type { CaptionContent } from '../components/LearningSupport'

export type CaptionBroadcastMessage = {
  caption: CaptionContent | null
  lectureSessionId: string
  sequence: number
  source: 'completed' | 'delta' | 'stopped'
  streamId: string
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
    typeof message.sequence === 'number' &&
    Number.isSafeInteger(message.sequence) &&
    message.sequence >= 0 &&
    typeof message.streamId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      message.streamId,
    ) &&
    typeof message.timestamp === 'number' &&
    (message.caption === null ||
      (typeof message.caption === 'object' &&
        typeof message.caption.text === 'string'))
  )
}
