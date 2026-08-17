import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import type { JoinedLectureSession } from '../lib/joinedLecture'
import type { LectureStatus } from '../types'
import {
  isPhase66UxIntegrationEnabled,
  isPhase68SecurityEnabled,
} from '../lib/featureFlags'

const LECTURE_RPC_TIMEOUT_MS = 12_000
const LECTURE_FUNCTION_TIMEOUT_MS = 15_000

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
  resumeTokenRequest?: Promise<LectureResumeTokenResult | null>
}

type IssueResumeTokenResponse = {
  expiresAt?: string
  lectureSessionId?: string
  ok?: boolean
  resumeToken?: string
}

export type LectureResumeTokenResult = {
  expiresAt: string
  lectureSessionId: string
  token: string
}

async function issueLectureResumeToken(
  lectureSessionId: string,
): Promise<LectureResumeTokenResult | null> {
  const { data, error } =
    await supabase.functions.invoke<IssueResumeTokenResponse>(
      'issue-lecture-resume-token',
      {
        body: { lectureSessionId },
        timeout: LECTURE_FUNCTION_TIMEOUT_MS,
      },
    )
  if (
    error ||
    !data?.ok ||
    data.lectureSessionId !== lectureSessionId ||
    !data.resumeToken ||
    !data.expiresAt
  ) {
    return null
  }

  return {
    expiresAt: data.expiresAt,
    lectureSessionId,
    token: data.resumeToken,
  }
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
    return 'この講義は終了しています。'
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

    const { data, error } = await supabase
      .rpc('get_lecture_session_state', {
        target_lecture_session_id: lectureSessionId,
      })
      .abortSignal(AbortSignal.timeout(LECTURE_RPC_TIMEOUT_MS))

    if (error) {
      throw new Error(error.message)
    }

    const rows = (data ?? []) as JoinLectureByCodeRow[]
    const row = rows[0]

    return row ? mapJoinedLecture(row) : null
  },

  async joinLectureByCode(
    lectureCode: string,
    captchaToken?: string,
  ): Promise<JoinedLectureWithParticipant> {
    assertSupabaseConfigured()

    const trimmedCode = lectureCode.trim()

    if (!trimmedCode) {
      throw new Error('講義コードを入力してください。')
    }

    await ensureAnonymousAuthSession(captchaToken)

    const { data, error } = await supabase
      .rpc(
        isPhase66UxIntegrationEnabled
          ? 'join_lecture_by_code_v2'
          : 'join_lecture_by_code',
        {
          lecture_code: trimmedCode,
        },
      )
      .abortSignal(AbortSignal.timeout(LECTURE_RPC_TIMEOUT_MS))

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

    const resumeTokenRequest = isPhase68SecurityEnabled
      ? issueLectureResumeToken(row.lecture_session_id).catch(() => null)
      : undefined

    return {
      lecture: mapJoinedLecture(row),
      participantId: row.participant_id,
      ...(resumeTokenRequest ? { resumeTokenRequest } : {}),
    }
  },
}
