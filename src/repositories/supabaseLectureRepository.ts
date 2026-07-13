import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import type { JoinedLectureSession } from '../lib/joinedLecture'
import type { LectureStatus } from '../types'

type JoinLectureByCodeRow = {
  lecture_session_id: string
  participant_id?: string
  title: string
  starts_at: string | null
  ends_at: string | null
  status: LectureStatus
}

export type JoinedLectureWithParticipant = {
  lecture: JoinedLectureSession
  participantId: string
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
    runtimeMode: 'live',
    status: row.status,
    title: row.title,
    endsAt: row.ends_at ?? undefined,
    startsAt: row.starts_at ?? undefined,
  }
}

export const supabaseLectureRepository = {
  async getLectureSessionState(
    lectureSessionId: string,
  ): Promise<JoinedLectureSession | null> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const { data, error } = await supabase.rpc('get_lecture_session_state', {
      target_lecture_session_id: lectureSessionId,
    })

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data ?? []) as JoinLectureByCodeRow[]
    const row = rows[0]

    return row ? mapJoinedLecture(row) : null
  },

  async joinLectureByCode(
    lectureCode: string,
  ): Promise<JoinedLectureWithParticipant> {
    assertSupabaseConfigured()

    const trimmedCode = lectureCode.trim()

    if (!trimmedCode) {
      throw new Error('講義コードを入力してください。')
    }

    await ensureAnonymousAuthSession()

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

    if (!row.participant_id) {
      throw new Error('参加者IDを発行できませんでした。')
    }

    return {
      lecture: mapJoinedLecture(row),
      participantId: row.participant_id,
    }
  },
}
