const STORAGE_KEY = 'compass-interactive-lecture-resume-tokens-v1'
const MAX_STORED_TOKENS = 10
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type StoredLectureResumeToken = {
  expiresAt: string
  lectureCode: string
  lectureSessionId: string
  token: string
}

function isValid(value: unknown): value is StoredLectureResumeToken {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return Boolean(
    typeof item.expiresAt === 'string' &&
    Date.parse(item.expiresAt) > Date.now() &&
    typeof item.lectureCode === 'string' &&
    /^[A-Z0-9-]{4,32}$/.test(item.lectureCode) &&
    typeof item.lectureSessionId === 'string' &&
    UUID_PATTERN.test(item.lectureSessionId) &&
    typeof item.token === 'string' &&
    item.token.length >= 80 &&
    item.token.length <= 2_048 &&
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(item.token),
  )
}

function readAll() {
  if (typeof window === 'undefined') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    parsed = []
  }
  const active = Array.isArray(parsed) ? parsed.filter(isValid) : []
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active))
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
  return active
}

export function persistLectureResumeToken(value: StoredLectureResumeToken) {
  if (typeof window === 'undefined' || !isValid(value)) return
  const current = readAll().filter(
    (item) => item.lectureSessionId !== value.lectureSessionId,
  )
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([value, ...current].slice(0, MAX_STORED_TOKENS)),
    )
  } catch {
    // Joining stays successful; code + Turnstile remains the fallback.
  }
}

export function restoreLectureResumeTokenByCode(lectureCode: string) {
  const normalized = lectureCode.trim().toUpperCase()
  return readAll().find((item) => item.lectureCode === normalized) ?? null
}

export function restoreLectureResumeTokenByLecture(lectureSessionId: string) {
  return (
    readAll().find((item) => item.lectureSessionId === lectureSessionId) ?? null
  )
}
