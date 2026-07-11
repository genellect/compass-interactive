import type { LectureRuntimeMode, LectureStatus } from '../types'
const LECTURE_SESSION_ID_STORAGE_KEY = 'compass-interactive-lecture-session-id'
const LECTURE_TITLE_STORAGE_KEY = 'compass-interactive-lecture-title'
const LECTURE_STATUS_STORAGE_KEY = 'compass-interactive-lecture-status'
const LECTURE_STARTS_AT_STORAGE_KEY = 'compass-interactive-lecture-starts-at'
const LECTURE_ENDS_AT_STORAGE_KEY = 'compass-interactive-lecture-ends-at'
const LECTURE_RUNTIME_MODE_STORAGE_KEY =
  'compass-interactive-lecture-runtime-mode'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const JOURNAL_CLUB_MVP_CODE = 'JC2026'

export type JoinedLectureSession = {
  id: string
  runtimeMode: LectureRuntimeMode
  title: string
  status: LectureStatus
  startsAt?: string
  endsAt?: string
}

function canUseLocalStorage() {
  return typeof window !== 'undefined' && 'localStorage' in window
}

export function restoreJoinedLectureSession(): JoinedLectureSession | null {
  if (!canUseLocalStorage()) {
    return null
  }

  const id = window.localStorage.getItem(LECTURE_SESSION_ID_STORAGE_KEY)
  const runtimeMode =
    window.localStorage.getItem(LECTURE_RUNTIME_MODE_STORAGE_KEY) === 'demo'
      ? 'demo'
      : 'live'

  if (!id || (runtimeMode === 'live' && !UUID_PATTERN.test(id))) {
    return null
  }

  const title = window.localStorage.getItem(LECTURE_TITLE_STORAGE_KEY)
  const status = window.localStorage.getItem(LECTURE_STATUS_STORAGE_KEY)
  const startsAt = window.localStorage.getItem(LECTURE_STARTS_AT_STORAGE_KEY)
  const endsAt = window.localStorage.getItem(LECTURE_ENDS_AT_STORAGE_KEY)

  return {
    id,
    runtimeMode,
    status: status === 'draft' || status === 'closed' ? status : 'open',
    title: title || '参加中の講義',
    ...(startsAt ? { startsAt } : {}),
    ...(endsAt ? { endsAt } : {}),
  }
}

export function persistJoinedLectureSession(lecture: JoinedLectureSession) {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.setItem(LECTURE_SESSION_ID_STORAGE_KEY, lecture.id)
  window.localStorage.setItem(
    LECTURE_RUNTIME_MODE_STORAGE_KEY,
    lecture.runtimeMode,
  )
  window.localStorage.setItem(LECTURE_TITLE_STORAGE_KEY, lecture.title)
  window.localStorage.setItem(LECTURE_STATUS_STORAGE_KEY, lecture.status)

  if (lecture.startsAt) {
    window.localStorage.setItem(LECTURE_STARTS_AT_STORAGE_KEY, lecture.startsAt)
  } else {
    window.localStorage.removeItem(LECTURE_STARTS_AT_STORAGE_KEY)
  }

  if (lecture.endsAt) {
    window.localStorage.setItem(LECTURE_ENDS_AT_STORAGE_KEY, lecture.endsAt)
  } else {
    window.localStorage.removeItem(LECTURE_ENDS_AT_STORAGE_KEY)
  }
}

export function clearJoinedLectureSession() {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.removeItem(LECTURE_SESSION_ID_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_TITLE_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_STATUS_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_STARTS_AT_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_ENDS_AT_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_RUNTIME_MODE_STORAGE_KEY)
}
