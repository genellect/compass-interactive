import type { JoinedLectureSession } from '../lib/joinedLecture'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import type { LiveComment, Poll, PollResponse } from '../types'
import type { DisplayState } from './supabaseDisplayStateRepository'
import type { PollResultSummary } from './supabasePollRepository'

export type LiveStateVersions = {
  caption: number | null
  comments: number | null
  display: number | null
  lecture: number | null
  likes: number | null
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
  pollResponses: PollResponse[] | null
  pollResults: PollResultSummary[] | null
  polls: Poll[] | null
  stateChanged: boolean
  versions: LiveStateVersions
}

export type CommentHistoryPage = {
  hasOlder: boolean
  items: LiveComment[]
}

type SnapshotRequest = {
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
  participant_id?: string
  status: 'visible'
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
  ends_at: string | null
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
    caption?: unknown
    comments?: {
      has_more: boolean
      has_older: boolean
      items: RawComment[]
      mode: 'delta' | 'initial'
    }
    lecture?: RawLecture
    likes?: RawLikeTotal[]
    pdf?: RawDisplay
    polls?: RawPoll[]
    summaries?: unknown[]
  }
  contract_version: 2
  versions: {
    caption: number
    comments: number
    lecture: number
    likes: number
    pdf: number
    polls: number
    summaries: number
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

function mapComment(row: RawComment): LiveComment {
  return {
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isPinned: row.is_pinned,
    lectureId: row.lecture_session_id,
    likeCount: Number(row.like_count ?? 0),
    likedByParticipantIds: [],
    participantId: row.participant_id ?? '',
    status: 'visible',
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
  }
}

function mapDisplay(raw: RawDisplay): DisplayState {
  return {
    currentPdfPage: raw.current_pdf_page,
    displayMode: raw.display_mode,
    lectureSessionId: raw.lecture_session_id,
    pdfDocumentId: raw.pdf_document_id,
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
    pollResponses,
    pollResults,
    polls,
    stateChanged: raw.state_changed,
    versions: {
      caption: null,
      comments: Number(raw.versions.comments),
      display: Number(raw.versions.display),
      lecture: null,
      likes: Number(raw.versions.likes),
      pdf: null,
      polls: Number(raw.versions.polls),
      state: Number(raw.versions.state),
      summaries: null,
    },
  }
}

function mapPublicSnapshotV2(raw: RawPublicSnapshotV2): LiveSnapshot {
  const { pollResults, polls } = mapPolls(raw.changed.polls)

  return {
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
    pollResponses: null,
    pollResults,
    polls,
    stateChanged: Object.keys(raw.changed).length > 0,
    versions: {
      caption: Number(raw.versions.caption),
      comments: Number(raw.versions.comments),
      display: null,
      lecture: Number(raw.versions.lecture),
      likes: Number(raw.versions.likes),
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
  const { data, error } = await supabase.rpc('get_lecture_public_snapshot_v2', {
    comment_cursor_created_at: commentCursor?.createdAt,
    comment_cursor_id: commentCursor?.id,
    comment_limit: 100,
    known_caption_version: versions.caption ?? undefined,
    known_comments_version: versions.comments ?? undefined,
    known_lecture_version: versions.lecture ?? undefined,
    known_likes_version: versions.likes ?? undefined,
    known_pdf_version: versions.pdf ?? undefined,
    known_polls_version: versions.polls ?? undefined,
    known_summaries_version: versions.summaries ?? undefined,
    target_lecture_session_id: lectureSessionId,
  })

  if (error) {
    throw new Error(error.message)
  }

  return data ? mapPublicSnapshotV2(data as unknown as RawPublicSnapshotV2) : null
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
      throw new Error('講義のlive snapshotが見つかりません。')
    }

    return snapshot
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
}
