export const DEV_LECTURE_SESSION_ID =
  import.meta.env.VITE_DEV_LECTURE_SESSION_ID?.trim() ?? ''

export const DEV_LECTURE_TITLE = 'Supabase接続テスト講義'

export function hasDevLectureSessionId() {
  return DEV_LECTURE_SESSION_ID.length > 0
}
