import { supabase } from '../lib/supabaseClient'
import type { JoinedLectureSession } from '../lib/joinedLecture'
import type { LectureStatus } from '../types'

type JoinLectureByCodeRow = {
  lecture_session_id: string
  title: string
  starts_at: string | null
  ends_at: string | null
  status: LectureStatus
}

function getJoinErrorMessage(message: string) {
  const normalizedMessage = message.toLowerCase()

  if (normalizedMessage.includes('expired')) {
    return 'この講義コードは期限切れです。'
  }

  if (
    normalizedMessage.includes('closed') ||
    normalizedMessage.includes('not open')
  ) {
    return 'この講義は現在openではありません。'
  }

  if (normalizedMessage.includes('not found')) {
    return '講義コードが見つかりません。'
  }

  if (normalizedMessage.includes('empty')) {
    return '講義コードを入力してください。'
  }

  return message
}

function mapJoinedLecture(row: JoinLectureByCodeRow): JoinedLectureSession {
  return {
    id: row.lecture_session_id,
    status: row.status,
    title: row.title,
    endsAt: row.ends_at ?? undefined,
    startsAt: row.starts_at ?? undefined,
  }
}

export const supabaseLectureRepository = {
  async joinLectureByCode(lectureCode: string): Promise<JoinedLectureSession> {
    const trimmedCode = lectureCode.trim()

    if (!trimmedCode) {
      throw new Error('講義コードを入力してください。')
    }

    const { data, error } = await supabase.rpc('join_lecture_by_code', {
      lecture_code: trimmedCode,
    })

    if (error) {
      throw new Error(getJoinErrorMessage(error.message))
    }

    const rows = (data ?? []) as JoinLectureByCodeRow[]
    const row = rows[0]

    if (!row) {
      throw new Error('講義コードが見つかりません。')
    }

    return mapJoinedLecture(row)
  },
}
