import type { LectureStatus } from '../types'
const LECTURE_SESSION_ID_STORAGE_KEY =
  'compass-interactive-lecture-session-id'
const LECTURE_TITLE_STORAGE_KEY = 'compass-interactive-lecture-title'
const LECTURE_STATUS_STORAGE_KEY = 'compass-interactive-lecture-status'
const LECTURE_STARTS_AT_STORAGE_KEY = 'compass-interactive-lecture-starts-at'
const LECTURE_ENDS_AT_STORAGE_KEY = 'compass-interactive-lecture-ends-at'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const JOURNAL_CLUB_MVP_CODE = 'JC2026'

export type JoinedLectureSession = {
  id: string
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

  if (!id || !UUID_PATTERN.test(id)) {
    return null
  }

  return {
    id,
    status: 'open',
    title: '参加中の講義',
  }
}

export function persistJoinedLectureSession(lecture: JoinedLectureSession) {
  if (!canUseLocalStorage()) {
    return
  }

  window.localStorage.setItem(LECTURE_SESSION_ID_STORAGE_KEY, lecture.id)
  window.localStorage.removeItem(LECTURE_TITLE_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_STATUS_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_STARTS_AT_STORAGE_KEY)
  window.localStorage.removeItem(LECTURE_ENDS_AT_STORAGE_KEY)
}
