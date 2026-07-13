import type { JoinedLectureSession } from '../lib/joinedLecture'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import { assertSupabaseConfigured, supabase } from '../lib/supabaseClient'
import type { LiveComment, Poll, PollResponse } from '../types'
import type { DisplayState } from './supabaseDisplayStateRepository'
import type { PollResultSummary } from './supabasePollRepository'

export type LiveStateVersions = {
  comments: number | null
  display: number | null
  likes: number | null
  polls: number | null
  state: number | null
}

export type CommentCursor = {
  createdAt: string
  id: string
}

export type CommentLikeTotal = {
  commentId: string
  likeCount: number
  likedByParticipant: boolean
}

export type LiveSnapshot = {
  comments: {
    hasMore: boolean
    hasOlder: boolean
    items: LiveComment[]
    mode: 'delta' | 'initial'
  } | null
  currentParticipantId: string | null
  display: DisplayState | null
  lecture: JoinedLectureSession
  likeTotals: CommentLikeTotal[] | null
  pollResponses: PollResponse[] | null
  pollResults: PollResultSummary[] | null
  polls: Poll[] | null
  stateChanged: boolean
  versions: LiveStateVersions
}

type SnapshotRequest = {
  commentCursor: CommentCursor | null
  lectureSessionId: string
  versions: LiveStateVersions
}

type RawComment = {
  body: string
  created_at: string
  id: string
  is_pinned: boolean
  lecture_session_id: string
  participant_id: string
  status: 'visible'
}

type RawLikeTotal = {
  comment_id: string
  like_count: number
  liked_by_participant: boolean
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
  participant_option_ids: string[]
  question: string
  status: 'open'
  type: 'multiple' | 'single'
}

type RawSnapshot = {
  comments: {
    has_more: boolean
    has_older: boolean
    items: RawComment[]
    mode: 'delta' | 'initial'
  } | null
  current_participant_id: string | null
  display: {
    current_pdf_page: number
    display_mode: DisplayState['displayMode']
    lecture_session_id: string
    pdf_document_id: string | null
    updated_at: string
  } | null
  lecture: {
    ends_at: string | null
    lecture_session_id: string
    starts_at: string | null
    status: JoinedLectureSession['status']
    title: string
  }
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

function mapComment(row: RawComment): LiveComment {
  return {
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    isPinned: row.is_pinned,
    lectureId: row.lecture_session_id,
    likeCount: 0,
    likedByParticipantIds: [],
    participantId: row.participant_id,
    status: 'visible',
  }
}

function mapSnapshot(raw: RawSnapshot): LiveSnapshot {
  const polls =
    raw.polls?.map<Poll>((poll) => ({
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
    raw.polls?.flatMap((poll) =>
      poll.options.map<PollResultSummary>((option) => ({
        optionId: option.id,
        pollId: poll.id,
        responseCount: Number(option.response_count),
      })),
    ) ?? null

  const pollResponses =
    raw.polls && raw.current_participant_id
      ? raw.polls
          .filter((poll) => poll.participant_option_ids.length > 0)
          .map<PollResponse>((poll) => ({
            createdAt: new Date().toISOString(),
            id: `snapshot-response-${poll.id}-${raw.current_participant_id}`,
            optionIds: poll.participant_option_ids,
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
    currentParticipantId: raw.current_participant_id,
    display: raw.display
      ? {
          currentPdfPage: raw.display.current_pdf_page,
          displayMode: raw.display.display_mode,
          lectureSessionId: raw.display.lecture_session_id,
          pdfDocumentId: raw.display.pdf_document_id,
          updatedAt: raw.display.updated_at,
        }
      : null,
    lecture: {
      id: raw.lecture.lecture_session_id,
      runtimeMode: 'live',
      status: raw.lecture.status,
      title: raw.lecture.title,
      ...(raw.lecture.starts_at ? { startsAt: raw.lecture.starts_at } : {}),
      ...(raw.lecture.ends_at ? { endsAt: raw.lecture.ends_at } : {}),
    },
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
      comments: Number(raw.versions.comments),
      display: Number(raw.versions.display),
      likes: Number(raw.versions.likes),
      polls: Number(raw.versions.polls),
      state: Number(raw.versions.state),
    },
  }
}

export const supabaseLiveStateRepository = {
  async getSnapshot({
    commentCursor,
    lectureSessionId,
    versions,
  }: SnapshotRequest): Promise<LiveSnapshot> {
    assertSupabaseConfigured()
    await ensureAnonymousAuthSession()

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

    if (!data) {
      throw new Error('講義のlive snapshotが見つかりません。')
    }

    return mapSnapshot(data as unknown as RawSnapshot)
  },
}
