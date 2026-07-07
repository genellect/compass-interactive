const PARTICIPANT_ID_STORAGE_KEY = 'compass-interactive-participant-id'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isParticipantUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value)
}

export function createParticipantId() {
  return window.crypto.randomUUID()
}

function getStorageKey(baseKey: string, lectureSessionId?: string) {
  return lectureSessionId ? `${baseKey}:${lectureSessionId}` : baseKey
}

function createParticipantKey() {
  return `participant-${createParticipantId()}`
}

function clearLegacyParticipantKeyStorage(lectureSessionId?: string) {
  window.localStorage.removeItem('compass-interactive-participant-key')
  window.localStorage.removeItem('compass-interactive-participant-key-owner')
  window.localStorage.removeItem(
    `compass-interactive-participant-key:${lectureSessionId}`,
  )
  window.localStorage.removeItem(
    `compass-interactive-participant-key-owner:${lectureSessionId}`,
  )
}

function clearStoredParticipantIdentity(lectureSessionId?: string) {
  window.localStorage.removeItem(
    getStorageKey(PARTICIPANT_ID_STORAGE_KEY, lectureSessionId),
  )
  clearLegacyParticipantKeyStorage(lectureSessionId)
}

export function restoreLocalParticipantId(lectureSessionId?: string) {
  const storedParticipantId = window.localStorage.getItem(
    getStorageKey(PARTICIPANT_ID_STORAGE_KEY, lectureSessionId),
  )

  if (!isParticipantUuid(storedParticipantId)) {
    clearStoredParticipantIdentity(lectureSessionId)
    return null
  }

  return storedParticipantId
}

export function getOrCreateLocalParticipantKey(
  participantId: string,
  lectureSessionId?: string,
) {
  if (isParticipantUuid(participantId)) {
    clearLegacyParticipantKeyStorage(lectureSessionId)
    return `participant-${participantId}`
  }

  clearLegacyParticipantKeyStorage(lectureSessionId)
  return createParticipantKey()
}

export function persistLocalParticipantIdentity(
  participantId: string,
  lectureSessionId?: string,
) {
  window.localStorage.setItem(
    getStorageKey(PARTICIPANT_ID_STORAGE_KEY, lectureSessionId),
    participantId,
  )
  clearLegacyParticipantKeyStorage(lectureSessionId)
}
