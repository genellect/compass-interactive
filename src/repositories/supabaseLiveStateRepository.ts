import type { JoinedLectureSession } from '../lib/joinedLecture'
import type { AdminOperationCredentialInput } from '../lib/adminAuth/adminOperationCredential'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import type { LiveComment, Poll, PollResponse } from '../types'
import type { DisplayState } from './supabaseDisplayStateRepository'
import type { PollResultSummary } from './supabasePollRepository'
import {
  isPhase4RealtimeCaptionsEnabled,
  isPhase66UxIntegrationEnabled,
  isPhase6SummariesEnabled,
  isPhase71ClassroomExtensionsEnabled,
  isPhase72AcademicAnswersEnabled,
} from '../lib/featureFlags'

import {
  getFunctionErrorMessage,
  SUPABASE_REQUEST_TIMEOUT_MS,
} from './supabase/requestPolicy'
import { invokeEdgeFunction } from './supabase/transport'

const {
  liveRpc: LIVE_RPC_TIMEOUT_MS,
  operatorFunction: OPERATOR_FUNCTION_TIMEOUT_MS,
} = SUPABASE_REQUEST_TIMEOUT_MS
import {
  mapAcademicAnswers,
  mapComment,
  mapDisplay,
  mapLecture,
  mapLegacySnapshot,
  mapPublicSnapshotV2,
  mapSummaries,
  mapTerminalState,
  type OperatorFunctionResponse,
  type OperatorSnapshotRequest,
  type RawArchiveV2,
  type RawCommentHistoryV2,
  type RawLegacySnapshot,
  type RawParticipantStateV2,
  type RawPublicSnapshotV2,
  type RawTerminalStateV2,
} from './supabase/liveStateMappers'

export type { OperatorSnapshotRequest } from './supabase/liveStateMappers'

export type PublicCaption = {
  language: 'auto' | 'en' | 'ja' | 'mixed' | 'und'
  lastItemId: string
  sequence: number
  text: string
  updatedAt: string
  windowEndedAt: string
  windowStartedAt: string
}

export type PublicLectureSummary = {
  commentPulse: string[]
  id: string
  lectureRecap: string[]
  pinned: boolean
  publishedAt: string
  reviewState: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
  revisionId: string
  windowEnd: string
  windowIndex: number
  windowStart: string
}

export type PublicMaterialSummary = {
  analysisId: string
  body: {
    lead: string
    points: Array<{
      detail?: string
      pageLabel: string
      title: string
    }>
    reflectionQuestion?: string
  }
  publishedAt: string
  reviewState: 'admin_confirmed' | 'admin_revised'
}

export type PublicAcademicSource = {
  authors: string[]
  doi: string | null
  journal: string
  pmid: string | null
  publicationTypes: string[]
  publicationYear: number
  sourceId: string
  sourceProvider: 'crossref_openalex' | 'pubmed'
  sourceRole: 'context' | 'primary'
  studyType: string
  title: string
}

export type PublicAcademicAnswer = {
  body: {
    answerPoints: Array<{ sourceIds: string[]; text: string }>
    limitations: string[]
  }
  id: string
  publishedAt: string
  question: string
  reviewState: 'admin_confirmed' | 'admin_revised' | 'ai_unreviewed'
  revisionId: string
  sources: PublicAcademicSource[]
}

export type LiveStateVersions = {
  caption: number | null
  comments: number | null
  display: number | null
  lecture: number | null
  likes: number | null
  metrics: number | null
  pdf: number | null
  polls: number | null
  state: number | null
  summaries: number | null
}

export type CommentCursor = {
  createdAt: string
  id: string
}

export type CommentHistoryScope = 'all' | 'mine'

export type CommentLikeTotal = {
  commentId: string
  likeCount: number
  likedByParticipant?: boolean
}

export type ParticipantLiveState = {
  commenting: {
    allowed: boolean
    maxLength: number
    nextAllowedAt: string | null
  }
  likedCommentIds: string[]
  participantId: string
  pollResponses: PollResponse[]
}

export type LiveSnapshot = {
  academicAnswers: PublicAcademicAnswer[] | null
  caption: PublicCaption | null | undefined
  comments: {
    hasMore: boolean
    hasOlder: boolean
    items: LiveComment[]
    mode: 'delta' | 'initial'
  } | null
  contractVersion: 1 | 2
  currentParticipantId: string | null
  display: DisplayState | null
  lecture: JoinedLectureSession | null
  likeTotals: CommentLikeTotal[] | null
  materialSummary: PublicMaterialSummary | null | undefined
  metrics: {
    hiddenCommentCount?: number
    participantCountApproximate: number
    participantCountMode: 'active_90s'
    updatedAt: string
    visibleCommentCount: number
  } | null
  pollResponses: PollResponse[] | null
  pollResults: PollResultSummary[] | null
  polls: Poll[] | null
  serverTime: string | null
  stateChanged: boolean
  summaries: PublicLectureSummary[] | null
  versions: LiveStateVersions
}

export type CommentHistoryPage = {
  hasOlder: boolean
  items: LiveComment[]
}

export type LectureArchive = {
  academicAnswers: PublicAcademicAnswer[]
  comments: LiveComment[]
  commentsHasMore: boolean
  lecture: JoinedLectureSession
  pdf: DisplayState | null
  summaries: PublicLectureSummary[]
}

export type SnapshotRequest = {
  commentCursor: CommentCursor | null
  lectureSessionId: string
  protocolVersion: 1 | 2
  versions: LiveStateVersions
}
async function getLegacySnapshot({
  commentCursor,
  lectureSessionId,
  versions,
}: SnapshotRequest) {
  const { data, error } = await supabase
    .rpc('get_lecture_live_snapshot', {
      comment_cursor_created_at: commentCursor?.createdAt,
      comment_cursor_id: commentCursor?.id,
      comment_limit: 100,
      known_comments_version: versions.comments ?? undefined,
      known_display_version: versions.display ?? undefined,
      known_likes_version: versions.likes ?? undefined,
      known_polls_version: versions.polls ?? undefined,
      known_state_version: versions.state ?? undefined,
      target_lecture_session_id: lectureSessionId,
    })
    .abortSignal(AbortSignal.timeout(LIVE_RPC_TIMEOUT_MS))

  if (error) {
    throw new Error(error.message)
  }

  return data ? mapLegacySnapshot(data as unknown as RawLegacySnapshot) : null
}

async function getPublicSnapshotV2({
  commentCursor,
  lectureSessionId,
  versions,
}: SnapshotRequest) {
  const rpcName = isPhase66UxIntegrationEnabled
    ? isPhase72AcademicAnswersEnabled
      ? 'get_lecture_public_snapshot_v6'
      : 'get_lecture_public_snapshot_v5'
    : isPhase6SummariesEnabled
      ? 'get_lecture_public_snapshot_v4'
      : isPhase4RealtimeCaptionsEnabled
        ? 'get_lecture_public_snapshot_v3'
        : 'get_lecture_public_snapshot_v2'
  const { data, error } = await supabase
    .rpc(rpcName, {
      comment_cursor_created_at: commentCursor?.createdAt,
      comment_cursor_id: commentCursor?.id,
      comment_limit: isPhase66UxIntegrationEnabled ? 5 : 100,
      known_caption_version: versions.caption ?? undefined,
      known_comments_version: versions.comments ?? undefined,
      known_lecture_version: versions.lecture ?? undefined,
      known_likes_version: versions.likes ?? undefined,
      ...(isPhase66UxIntegrationEnabled
        ? { known_metrics_version: versions.metrics ?? undefined }
        : {}),
      known_pdf_version: versions.pdf ?? undefined,
      known_polls_version: versions.polls ?? undefined,
      known_summaries_version: versions.summaries ?? undefined,
      target_lecture_session_id: lectureSessionId,
    })
    .abortSignal(AbortSignal.timeout(LIVE_RPC_TIMEOUT_MS))

  if (error) {
    throw new Error(error.message)
  }

  return data
    ? mapPublicSnapshotV2(data as unknown as RawPublicSnapshotV2)
    : null
}

async function getTerminalSnapshot(
  lectureSessionId: string,
): Promise<LiveSnapshot | null> {
  const { data, error } = await supabase
    .rpc('get_lecture_terminal_state_v2', {
      target_lecture_session_id: lectureSessionId,
    })
    .abortSignal(AbortSignal.timeout(LIVE_RPC_TIMEOUT_MS))

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }

  return mapTerminalState(data as unknown as RawTerminalStateV2)
}
export const supabaseLiveStateRepository = {
  async getSnapshot(request: SnapshotRequest): Promise<LiveSnapshot> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const snapshot =
      request.protocolVersion === 2
        ? await getPublicSnapshotV2(request)
        : await getLegacySnapshot(request)

    if (!snapshot) {
      const terminalSnapshot = await getTerminalSnapshot(
        request.lectureSessionId,
      )
      if (terminalSnapshot) {
        return terminalSnapshot
      }
      throw new Error('講義のlive snapshotが見つかりません。')
    }

    return snapshot
  },

  async getOperatorSnapshot(
    request: OperatorSnapshotRequest,
  ): Promise<LiveSnapshot> {
    assertSupabaseConfigured()
    if (request.displayToken) {
      await ensureAnonymousAuthSession()
    }

    const credential = request.adminToken
      ? { adminToken: request.adminToken }
      : request.displayToken
        ? { displayToken: request.displayToken }
        : null
    if (!credential) {
      throw new Error('An operator credential is required.')
    }
    const { data, error } = await invokeEdgeFunction<OperatorFunctionResponse>(
      'operator-live-snapshot',
      {
        body: {
          action: 'snapshot',
          commentCursorCreatedAt: request.commentCursor?.createdAt ?? null,
          commentCursorId: request.commentCursor?.id ?? null,
          knownCaptionVersion: request.versions.caption,
          knownCommentsVersion: request.versions.comments,
          knownLectureVersion: request.versions.lecture,
          knownLikesVersion: request.versions.likes,
          knownMetricsVersion: request.versions.metrics,
          knownPdfVersion: request.versions.pdf,
          knownPollsVersion: request.versions.polls,
          knownSummariesVersion: request.versions.summaries,
          lectureSessionId: request.lectureSessionId,
          ...credential,
        },
        timeout: OPERATOR_FUNCTION_TIMEOUT_MS,
      },
    )

    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Operator snapshot could not be loaded.',
        ),
      )
    }
    if (!data?.ok || !data.result) {
      throw new Error(data?.message ?? 'Operator snapshot could not be loaded.')
    }
    return data.result.mode === 'live'
      ? mapPublicSnapshotV2(data.result.snapshot)
      : mapTerminalState(data.result.terminal)
  },

  async getOperatorCommentHistory({
    adminToken,
    before,
    lectureSessionId,
    limit = 50,
  }: {
    adminToken: AdminOperationCredentialInput
    before: CommentCursor
    lectureSessionId: string
    limit?: number
  }): Promise<CommentHistoryPage> {
    assertSupabaseConfigured()
    const { data, error } = await invokeEdgeFunction<
      Omit<OperatorFunctionResponse, 'result'> & {
        result?: RawCommentHistoryV2
      }
    >('operator-live-snapshot', {
      body: {
        action: 'commentHistory',
        adminToken,
        commentCursorCreatedAt: before.createdAt,
        commentCursorId: before.id,
        lectureSessionId,
        limit,
      },
      timeout: OPERATOR_FUNCTION_TIMEOUT_MS,
    })
    if (error) {
      throw new Error(
        await getFunctionErrorMessage(
          error,
          'Operator comment history could not be loaded.',
        ),
      )
    }
    if (!data?.ok || !data.result) {
      throw new Error(
        data?.message ?? 'Operator comment history could not be loaded.',
      )
    }
    return {
      hasOlder: data.result.has_older,
      items: data.result.items.map(mapComment),
    }
  },

  async getParticipantState(
    lectureSessionId: string,
  ): Promise<ParticipantLiveState | null> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const { data, error } = await supabase
      .rpc('get_lecture_participant_state_v2', {
        target_lecture_session_id: lectureSessionId,
      })
      .abortSignal(AbortSignal.timeout(LIVE_RPC_TIMEOUT_MS))

    if (error) {
      throw new Error(error.message)
    }
    if (!data) {
      return null
    }

    const raw = data as unknown as RawParticipantStateV2
    const participantId = raw.membership.participant_id
    return {
      commenting: {
        allowed: raw.commenting.allowed,
        maxLength: Number(raw.commenting.max_length),
        nextAllowedAt: raw.commenting.next_allowed_at,
      },
      likedCommentIds: raw.liked_comment_ids,
      participantId,
      pollResponses: raw.poll_responses.map((response) => ({
        createdAt: response.created_at,
        id: `participant-response-${response.poll_id}-${participantId}`,
        optionIds: response.option_ids,
        participantId,
        pollId: response.poll_id,
      })),
    }
  },

  async getCommentHistory({
    before,
    lectureSessionId,
    limit = 50,
    scope = 'all',
  }: {
    before: CommentCursor | null
    lectureSessionId: string
    limit?: number
    scope?: CommentHistoryScope
  }): Promise<CommentHistoryPage> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    if (!isPhase71ClassroomExtensionsEnabled && !before) {
      throw new Error('A comment history cursor is required.')
    }

    const { data, error } = isPhase71ClassroomExtensionsEnabled
      ? await supabase.rpc('get_lecture_comment_history_v3', {
          ...(before
            ? {
                before_comment_id: before.id,
                before_created_at: before.createdAt,
              }
            : {}),
          history_limit: limit,
          history_scope: scope,
          target_lecture_session_id: lectureSessionId,
        })
      : await supabase.rpc('get_lecture_comment_history_v2', {
          before_comment_id: before!.id,
          before_created_at: before!.createdAt,
          history_limit: limit,
          target_lecture_session_id: lectureSessionId,
        })

    if (error) {
      throw new Error(error.message)
    }
    if (!data) {
      throw new Error('過去のコメントを取得できませんでした。')
    }

    const raw = data as unknown as RawCommentHistoryV2
    return {
      hasOlder: raw.has_older,
      items: raw.items.map(mapComment),
    }
  },

  async getArchive(lectureSessionId: string): Promise<LectureArchive | null> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const archiveRpc = isPhase72AcademicAnswersEnabled
      ? 'get_lecture_archive_v4'
      : isPhase6SummariesEnabled
        ? 'get_lecture_archive_v3'
        : 'get_lecture_archive_v2'
    const { data, error } = await supabase.rpc(archiveRpc, {
      target_lecture_session_id: lectureSessionId,
    })

    if (error) {
      throw new Error(error.message)
    }
    if (!data) {
      return null
    }

    const raw = data as unknown as RawArchiveV2
    return {
      academicAnswers: mapAcademicAnswers(raw.academic_answers) ?? [],
      comments: raw.comments.map(mapComment),
      commentsHasMore: raw.comments_has_more,
      lecture: mapLecture(raw.lecture),
      pdf: raw.pdf
        ? mapDisplay({
            ...raw.pdf,
            lecture_session_id: lectureSessionId,
          })
        : null,
      summaries: mapSummaries(raw.summaries) ?? [],
    }
  },
}
