import type { JoinedLectureSession } from '../lib/joinedLecture'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import type { LiveComment, Poll, PollResponse } from '../types'
import type { DisplayState } from './supabaseDisplayStateRepository'
import type { PollResultSummary } from './supabasePollRepository'
import {
  isPhase4RealtimeCaptionsEnabled,
  isPhase65CommentNicknamesEnabled,
  isPhase66UxIntegrationEnabled,
  isPhase6SummariesEnabled,
} from '../lib/featureFlags'
import { normalizeCommentNickname } from '../lib/commentNickname'

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

type RawComment = {
  body: string
  created_at: string
  id: string
  is_pinned: boolean
  lecture_session_id: string
  like_count?: number
  nickname?: string | null
  participant_id?: string
  status: 'hidden' | 'visible'
}

type RawLikeTotal = {
  comment_id: string
  like_count: number
  liked_by_participant?: boolean
}

type RawPollOption = {
  display_order: number
  id: string
  label: string
  poll_id: string
  response_count: number
}

type RawPoll = {
  created_at: string
  id: string
  lecture_session_id: string
  options: RawPollOption[]
  participant_option_ids?: string[]
  question: string
  status: 'open'
  type: 'multiple' | 'single'
}

type RawLecture = {
  archive_expires_at?: string | null
  closed_at?: string | null
  close_reason?: string | null
  ends_at: string | null
  hard_stop_at?: string | null
  lecture_session_id: string
  starts_at: string | null
  status: JoinedLectureSession['status']
  title: string
}

type RawDisplay = {
  current_pdf_page: number
  display_mode: DisplayState['displayMode']
  lecture_session_id: string
  pdf_document_id: string | null
  pdf_document_version?: string | null
  pdf_manifest_version?: number
  pdf_page_count?: number | null
  pdf_visible?: boolean
  updated_at: string
}

type RawLegacySnapshot = {
  comments: {
    has_more: boolean
    has_older: boolean
    items: RawComment[]
    mode: 'delta' | 'initial'
  } | null
  current_participant_id: string | null
  display: RawDisplay | null
  lecture: RawLecture
  like_totals: RawLikeTotal[] | null
  polls: RawPoll[] | null
  server_time?: string
  state_changed: boolean
  versions: {
    comments: number
    display: number
    likes: number
    polls: number
    state: number
  }
}

type RawPublicSnapshotV2 = {
  changed: {
    caption?: {
      language: PublicCaption['language']
      last_item_id: string
      sequence: number
      text: string
      updated_at: string
      window_ended_at: string
      window_started_at: string
    } | null
    comments?: {
      has_more: boolean
      has_older: boolean
      items: RawComment[]
      mode: 'delta' | 'initial'
    }
    lecture?: RawLecture
    likes?: RawLikeTotal[]
    metrics?: {
      hidden_comment_count?: number
      participant_count_approximate: number
      participant_count_mode: 'active_90s'
      updated_at: string
      visible_comment_count: number
    }
    material_summary?: RawPublicMaterialSummary | null
    pdf?: RawDisplay
    polls?: RawPoll[]
    summaries?: RawPublicSummary[]
  }
  contract_version: 2
  server_time: string
  versions: {
    caption: number
    comments: number
    lecture: number
    likes: number
    metrics?: number
    pdf: number
    polls: number
    summaries: number
  }
}

type RawPublicSummary = {
  comment_pulse: string[]
  id: string
  lecture_recap: string[]
  pinned: boolean
  published_at: string
  review_state: PublicLectureSummary['reviewState']
  revision_id: string
  window_end: string
  window_index: number
  window_start: string
}

type RawPublicMaterialSummary = {
  analysis_id: string
  body: {
    lead: string
    points: Array<{
      detail?: string
      pageLabel: string
      title: string
    }>
    reflectionQuestion?: string
  }
  published_at: string
  review_state: PublicMaterialSummary['reviewState']
}

function mapMaterialSummary(
  raw: RawPublicMaterialSummary | null | undefined,
): PublicMaterialSummary | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  return {
    analysisId: raw.analysis_id,
    body: raw.body,
    publishedAt: raw.published_at,
    reviewState: raw.review_state,
  }
}

type RawParticipantStateV2 = {
  commenting: {
    allowed: boolean
    max_length: number
    next_allowed_at: string | null
  }
  contract_version: 2
  liked_comment_ids: string[]
  membership: {
    participant_id: string
  }
  poll_responses: Array<{
    created_at: string
    option_ids: string[]
    poll_id: string
  }>
}

type RawCommentHistoryV2 = {
  contract_version: 2
  has_older: boolean
  items: RawComment[]
}

type RawTerminalStateV2 = {
  archive_expires_at: string | null
  closed_at: string | null
  close_reason: string | null
  hard_stop_at: string | null
  lecture_session_id: string
  server_time: string
  started_at: string | null
  status: 'closed'
  title: string
}

type RawArchiveV2 = {
  comments: RawComment[]
  comments_has_more: boolean
  lecture: RawLecture
  pdf: {
    current_pdf_page: number
    display_mode: DisplayState['displayMode']
    pdf_document_id: string | null
    updated_at: string
  } | null
  summaries: RawPublicSummary[]
}

type OperatorCredential =
  | { adminToken: string; displayToken?: never }
  | { adminToken?: never; displayToken: string }

export type OperatorSnapshotRequest = SnapshotRequest & OperatorCredential

type OperatorFunctionResponse = {
  message?: string
  ok?: boolean
  result?:
    | { mode: 'live'; snapshot: RawPublicSnapshotV2 }
    | { mode: 'terminal'; terminal: RawTerminalStateV2 }
}

function mapSummaries(raw: RawPublicSummary[] | undefined | null) {
  return (
    raw?.map<PublicLectureSummary>((summary) => ({
      commentPulse: summary.comment_pulse,
      id: summary.id,
      lectureRecap: summary.lecture_recap,
      pinned: summary.pinned,
      publishedAt: summary.published_at,
      reviewState: summary.review_state,
      revisionId: summary.revision_id,
      windowEnd: summary.window_end,
      windowIndex: Number(summary.window_index),
      windowStart: summary.window_start,
    })) ?? null
  )
}

function mapComment(row: RawComment): LiveComment {
  return {
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isPinned: row.is_pinned,
    lectureId: row.lecture_session_id,
    likeCount: Number(row.like_count ?? 0),
    likedByParticipantIds: [],
    nickname: isPhase65CommentNicknamesEnabled
      ? normalizeCommentNickname(row.nickname)
      : null,
    participantId: row.participant_id ?? '',
    status: row.status,
  }
}

function mapLecture(raw: RawLecture): JoinedLectureSession {
  return {
    id: raw.lecture_session_id,
    runtimeMode: 'live',
    status: raw.status,
    title: raw.title,
    ...(raw.starts_at ? { startsAt: raw.starts_at } : {}),
    ...(raw.ends_at ? { endsAt: raw.ends_at } : {}),
    ...(raw.hard_stop_at ? { hardStopAt: raw.hard_stop_at } : {}),
    ...(raw.closed_at ? { closedAt: raw.closed_at } : {}),
    ...(raw.close_reason ? { closeReason: raw.close_reason } : {}),
    ...(raw.archive_expires_at
      ? { archiveExpiresAt: raw.archive_expires_at }
      : {}),
  }
}

function mapDisplay(raw: RawDisplay): DisplayState {
  return {
    currentPdfPage: raw.current_pdf_page,
    displayMode: raw.display_mode,
    lectureSessionId: raw.lecture_session_id,
    pdfDocumentId: raw.pdf_document_id,
    pdfDocumentVersion: raw.pdf_document_version ?? null,
    pdfManifestVersion: raw.pdf_manifest_version ?? 0,
    pdfPageCount: raw.pdf_page_count ?? null,
    pdfVisible: raw.pdf_visible ?? Boolean(raw.pdf_document_id),
    updatedAt: raw.updated_at,
  }
}

function mapPolls(rawPolls: RawPoll[] | undefined | null) {
  const polls =
    rawPolls?.map<Poll>((poll) => ({
      createdAt: poll.created_at,
      id: poll.id,
      lectureId: poll.lecture_session_id,
      options: poll.options.map((option) => ({
        id: option.id,
        label: option.label,
        order: option.display_order,
        pollId: option.poll_id,
      })),
      question: poll.question,
      status: poll.status,
      type: poll.type,
    })) ?? null

  const pollResults =
    rawPolls?.flatMap((poll) =>
      poll.options.map<PollResultSummary>((option) => ({
        optionId: option.id,
        pollId: poll.id,
        responseCount: Number(option.response_count),
      })),
    ) ?? null

  return { pollResults, polls }
}

function mapLegacySnapshot(raw: RawLegacySnapshot): LiveSnapshot {
  const { pollResults, polls } = mapPolls(raw.polls)
  const pollResponses =
    raw.polls && raw.current_participant_id
      ? raw.polls
          .filter((poll) => (poll.participant_option_ids?.length ?? 0) > 0)
          .map<PollResponse>((poll) => ({
            createdAt: new Date().toISOString(),
            id: `snapshot-response-${poll.id}-${raw.current_participant_id}`,
            optionIds: poll.participant_option_ids ?? [],
            participantId: raw.current_participant_id as string,
            pollId: poll.id,
          }))
      : raw.polls
        ? []
        : null

  return {
    caption: undefined,
    comments: raw.comments
      ? {
          hasMore: raw.comments.has_more,
          hasOlder: raw.comments.has_older,
          items: raw.comments.items.map(mapComment),
          mode: raw.comments.mode,
        }
      : null,
    contractVersion: 1,
    currentParticipantId: raw.current_participant_id,
    display: raw.display ? mapDisplay(raw.display) : null,
    lecture: mapLecture(raw.lecture),
    likeTotals:
      raw.like_totals?.map((total) => ({
        commentId: total.comment_id,
        likeCount: Number(total.like_count),
        likedByParticipant: total.liked_by_participant,
      })) ?? null,
    materialSummary: undefined,
    metrics: null,
    pollResponses,
    pollResults,
    polls,
    serverTime: raw.server_time ?? null,
    stateChanged: raw.state_changed,
    summaries: null,
    versions: {
      caption: null,
      comments: Number(raw.versions.comments),
      display: Number(raw.versions.display),
      lecture: null,
      likes: Number(raw.versions.likes),
      metrics: null,
      pdf: null,
      polls: Number(raw.versions.polls),
      state: Number(raw.versions.state),
      summaries: null,
    },
  }
}

function mapPublicSnapshotV2(raw: RawPublicSnapshotV2): LiveSnapshot {
  const { pollResults, polls } = mapPolls(raw.changed.polls)
  const caption = Object.hasOwn(raw.changed, 'caption')
    ? raw.changed.caption
      ? {
          language: raw.changed.caption.language,
          lastItemId: raw.changed.caption.last_item_id,
          sequence: Number(raw.changed.caption.sequence),
          text: raw.changed.caption.text,
          updatedAt: raw.changed.caption.updated_at,
          windowEndedAt: raw.changed.caption.window_ended_at,
          windowStartedAt: raw.changed.caption.window_started_at,
        }
      : null
    : undefined

  return {
    caption,
    comments: raw.changed.comments
      ? {
          hasMore: raw.changed.comments.has_more,
          hasOlder: raw.changed.comments.has_older,
          items: raw.changed.comments.items.map(mapComment),
          mode: raw.changed.comments.mode,
        }
      : null,
    contractVersion: 2,
    currentParticipantId: null,
    display: raw.changed.pdf ? mapDisplay(raw.changed.pdf) : null,
    lecture: raw.changed.lecture ? mapLecture(raw.changed.lecture) : null,
    likeTotals:
      raw.changed.likes?.map((total) => ({
        commentId: total.comment_id,
        likeCount: Number(total.like_count),
      })) ?? null,
    materialSummary: Object.hasOwn(raw.changed, 'material_summary')
      ? mapMaterialSummary(raw.changed.material_summary)
      : undefined,
    metrics: raw.changed.metrics
      ? {
          ...(raw.changed.metrics.hidden_comment_count === undefined
            ? {}
            : {
                hiddenCommentCount: Number(
                  raw.changed.metrics.hidden_comment_count,
                ),
              }),
          participantCountApproximate: Number(
            raw.changed.metrics.participant_count_approximate,
          ),
          participantCountMode: raw.changed.metrics.participant_count_mode,
          updatedAt: raw.changed.metrics.updated_at,
          visibleCommentCount: Number(
            raw.changed.metrics.visible_comment_count,
          ),
        }
      : null,
    pollResponses: null,
    pollResults,
    polls,
    serverTime: raw.server_time,
    stateChanged: Object.keys(raw.changed).length > 0,
    summaries: mapSummaries(raw.changed.summaries),
    versions: {
      caption: Number(raw.versions.caption),
      comments: Number(raw.versions.comments),
      display: null,
      lecture: Number(raw.versions.lecture),
      likes: Number(raw.versions.likes),
      metrics:
        raw.versions.metrics === undefined
          ? null
          : Number(raw.versions.metrics),
      pdf: Number(raw.versions.pdf),
      polls: Number(raw.versions.polls),
      state: null,
      summaries: Number(raw.versions.summaries),
    },
  }
}

async function getLegacySnapshot({
  commentCursor,
  lectureSessionId,
  versions,
}: SnapshotRequest) {
  const { data, error } = await supabase.rpc('get_lecture_live_snapshot', {
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
    ? 'get_lecture_public_snapshot_v5'
    : isPhase6SummariesEnabled
      ? 'get_lecture_public_snapshot_v4'
      : isPhase4RealtimeCaptionsEnabled
        ? 'get_lecture_public_snapshot_v3'
        : 'get_lecture_public_snapshot_v2'
  const { data, error } = await supabase.rpc(rpcName, {
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
  const { data, error } = await supabase.rpc('get_lecture_terminal_state_v2', {
    target_lecture_session_id: lectureSessionId,
  })

  if (error) {
    throw new Error(error.message)
  }
  if (!data) {
    return null
  }

  return mapTerminalState(data as unknown as RawTerminalStateV2)
}

function mapTerminalState(raw: RawTerminalStateV2): LiveSnapshot {
  return {
    caption: null,
    comments: null,
    contractVersion: 2,
    currentParticipantId: null,
    display: null,
    lecture: mapLecture({
      archive_expires_at: raw.archive_expires_at,
      closed_at: raw.closed_at,
      close_reason: raw.close_reason,
      ends_at: raw.hard_stop_at,
      hard_stop_at: raw.hard_stop_at,
      lecture_session_id: raw.lecture_session_id,
      starts_at: raw.started_at,
      status: raw.status,
      title: raw.title,
    }),
    likeTotals: null,
    materialSummary: null,
    metrics: null,
    pollResponses: null,
    pollResults: null,
    polls: null,
    serverTime: raw.server_time,
    stateChanged: true,
    summaries: null,
    versions: {
      caption: null,
      comments: null,
      display: null,
      lecture: null,
      likes: null,
      metrics: null,
      pdf: null,
      polls: null,
      state: null,
      summaries: null,
    },
  }
}

async function getFunctionErrorMessage(
  error: unknown,
  fallbackMessage: string,
) {
  if (!(error instanceof Error)) {
    return fallbackMessage
  }

  const maybeResponse = (error as { context?: unknown }).context
  if (maybeResponse instanceof Response) {
    try {
      const body = (await maybeResponse.clone().json()) as {
        message?: string
      }
      return body.message ?? error.message
    } catch {
      return error.message
    }
  }
  return error.message
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
    await ensureAnonymousAuthSession()

    const credential = request.adminToken
      ? { adminToken: request.adminToken }
      : request.displayToken
        ? { displayToken: request.displayToken }
        : null
    if (!credential) {
      throw new Error('An operator credential is required.')
    }
    const { data, error } =
      await supabase.functions.invoke<OperatorFunctionResponse>(
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
    adminToken: string
    before: CommentCursor
    lectureSessionId: string
    limit?: number
  }): Promise<CommentHistoryPage> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const { data, error } = await supabase.functions.invoke<
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

    const { data, error } = await supabase.rpc(
      'get_lecture_participant_state_v2',
      { target_lecture_session_id: lectureSessionId },
    )

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
  }: {
    before: CommentCursor
    lectureSessionId: string
    limit?: number
  }): Promise<CommentHistoryPage> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

    const { data, error } = await supabase.rpc(
      'get_lecture_comment_history_v2',
      {
        before_comment_id: before.id,
        before_created_at: before.createdAt,
        history_limit: limit,
        target_lecture_session_id: lectureSessionId,
      },
    )

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

    const archiveRpc = isPhase6SummariesEnabled
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
