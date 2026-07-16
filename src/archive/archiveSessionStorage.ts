const ARCHIVE_RESUME_CODE_STORAGE_KEY =
  'compass-interactive-lecture-archive-resume-code-v1'

function normalizeArchiveResumeCode(value: string) {
  const normalized = value.trim().toUpperCase()
  return /^[A-Z0-9-]{4,32}$/.test(normalized) ? normalized : null
}

export function clearLectureArchiveResumeCode() {
  window.sessionStorage.removeItem(ARCHIVE_RESUME_CODE_STORAGE_KEY)
}

export function persistLectureArchiveResumeCode(lectureCode: string) {
  const normalized = normalizeArchiveResumeCode(lectureCode)
  if (!normalized) return
  window.sessionStorage.setItem(
    ARCHIVE_RESUME_CODE_STORAGE_KEY,
    normalized,
  )
}

export function restoreLectureArchiveResumeCode() {
  const stored = window.sessionStorage.getItem(
    ARCHIVE_RESUME_CODE_STORAGE_KEY,
  )
  if (!stored) return null
  const normalized = normalizeArchiveResumeCode(stored)
  if (!normalized) {
    clearLectureArchiveResumeCode()
    return null
  }
  return normalized
}
