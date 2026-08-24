import type { ClaimedDisplayRealtimeSession } from './displayRealtime'

const DISPLAY_SESSION_STORAGE_KEY = 'compass.display.launch.v1'
const STORAGE_VERSION = 1
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DisplayLaunch = {
  displayToken: string
  lectureCode: string
  lectureSessionId: string
  source: 'fragment' | 'none' | 'sessionStorage'
}

type StoredDisplayLaunch = {
  connectionGeneration: number
  displayToken: string
  lectureCode: string
  lectureSessionId: string
  realtime: ClaimedDisplayRealtimeSession
  version: typeof STORAGE_VERSION
}

function isStoredDisplayLaunch(value: unknown): value is StoredDisplayLaunch {
  if (!value || typeof value !== 'object') return false
  const stored = value as Partial<StoredDisplayLaunch>
  const realtime = stored.realtime
  if (!realtime || typeof realtime !== 'object') return false
  const expiresAt = Date.parse(realtime.expiresAt ?? '')
  const hardStopAt = Date.parse(realtime.hardStopAt ?? '')
  return (
    stored.version === STORAGE_VERSION &&
    typeof stored.displayToken === 'string' &&
    stored.displayToken.length >= 80 &&
    stored.displayToken.length <= 4_096 &&
    typeof stored.lectureCode === 'string' &&
    (stored.lectureCode === '' || /^[0-9]{6}$/.test(stored.lectureCode)) &&
    typeof stored.lectureSessionId === 'string' &&
    UUID_PATTERN.test(stored.lectureSessionId) &&
    Number.isSafeInteger(stored.connectionGeneration) &&
    Number(stored.connectionGeneration) >= 1 &&
    Number(stored.connectionGeneration) <= 2_147_483_647 &&
    realtime.lectureSessionId === stored.lectureSessionId &&
    UUID_PATTERN.test(realtime.sessionId ?? '') &&
    typeof realtime.topic === 'string' &&
    realtime.topic.startsWith('display:' + stored.lectureSessionId + ':') &&
    Number.isFinite(expiresAt) &&
    Number.isFinite(hardStopAt) &&
    Math.min(expiresAt, hardStopAt) > Date.now()
  )
}

function readStoredDisplayLaunch() {
  try {
    const raw = window.sessionStorage.getItem(DISPLAY_SESSION_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (isStoredDisplayLaunch(parsed)) return parsed
    window.sessionStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in hardened browser profiles.
  }
  return null
}

export function readDisplayLaunch(): DisplayLaunch {
  const fragment = new URLSearchParams(window.location.hash.slice(1))
  const fragmentToken = fragment.get('token') ?? ''
  const fragmentLectureCode = fragment.get('code') ?? ''
  const fragmentLectureSessionId = fragment.get('lecture') ?? ''
  if (
    fragmentToken.length > 0 ||
    fragmentLectureCode.length > 0 ||
    fragmentLectureSessionId.length > 0
  ) {
    return {
      displayToken: fragmentToken,
      lectureCode: fragmentLectureCode,
      lectureSessionId: fragmentLectureSessionId,
      source: 'fragment',
    }
  }

  const stored = readStoredDisplayLaunch()
  return stored
    ? {
        displayToken: stored.displayToken,
        lectureCode: stored.lectureCode,
        lectureSessionId: stored.lectureSessionId,
        source: 'sessionStorage',
      }
    : {
        displayToken: '',
        lectureCode: '',
        lectureSessionId: '',
        source: 'none',
      }
}

export function persistClaimedDisplayLaunch(input: {
  displayToken: string
  lectureCode: string
  lectureSessionId: string
  realtime: ClaimedDisplayRealtimeSession
}) {
  const previous = readStoredDisplayLaunch()
  const previousGeneration =
    previous?.realtime.sessionId === input.realtime.sessionId
      ? previous.connectionGeneration
      : 0
  const connectionGeneration = Math.min(previousGeneration + 1, 2_147_483_647)
  const stored: StoredDisplayLaunch = {
    connectionGeneration,
    displayToken: input.displayToken,
    lectureCode: /^[0-9]{6}$/.test(input.lectureCode) ? input.lectureCode : '',
    lectureSessionId: input.lectureSessionId,
    realtime: input.realtime,
    version: STORAGE_VERSION,
  }
  try {
    window.sessionStorage.setItem(
      DISPLAY_SESSION_STORAGE_KEY,
      JSON.stringify(stored),
    )
    return { connectionGeneration, persisted: true }
  } catch {
    return { connectionGeneration, persisted: false }
  }
}

export function clearStoredDisplayLaunch() {
  try {
    window.sessionStorage.removeItem(DISPLAY_SESSION_STORAGE_KEY)
  } catch {
    // A terminal session is already unusable even when storage is unavailable.
  }
}

export function stripDisplayLaunchFragment() {
  window.history.replaceState(
    null,
    '',
    window.location.pathname + window.location.search,
  )
}
