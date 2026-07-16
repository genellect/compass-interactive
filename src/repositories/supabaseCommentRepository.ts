import { supabase } from '../lib/supabaseClient'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'
import type { LiveComment } from '../types'
import { normalizeCommentNickname } from '../lib/commentNickname'

type CommentRow = {
  id: string
  lecture_session_id: string
  participant_id: string
  nickname: string | null
  body: string
  status: 'visible' | 'hidden' | 'deleted'
  is_pinned: boolean
  created_at: string
  updated_at: string
}

function mapCommentRow(row: CommentRow): LiveComment {
  return {
    id: row.id,
    lectureId: row.lecture_session_id,
    participantId: row.participant_id,
    nickname: row.nickname,
    body: row.body,
    likeCount: 0,
    likedByParticipantIds: [],
    status: row.status === 'hidden' ? 'hidden' : 'visible',
    isPinned: row.is_pinned,
    createdAt: row.created_at,
  }
}

export const supabaseCommentRepository = {
  async createVisibleComment({
    body,
    lectureSessionId,
    participantId,
    nickname,
  }: {
    body: string
    lectureSessionId: string
    participantId: string
    nickname?: string | null
  }): Promise<LiveComment> {
    await ensureAnonymousAuthSession()

    const trimmedBody = body.trim().slice(0, 120)
    const normalizedNickname = normalizeCommentNickname(nickname)
    if (!trimmedBody) {
      throw new Error('コメントを入力してください。')
    }

    const { data, error } = await supabase
      .from('comments')
      .insert({
        lecture_session_id: lectureSessionId,
        participant_id: participantId,
        nickname: normalizedNickname,
        body: trimmedBody,
        status: 'visible',
        is_pinned: false,
      })
      .select(
        'id, lecture_session_id, participant_id, nickname, body, status, is_pinned, created_at, updated_at',
      )
      .single()

    if (error) {
      throw new Error(error.message)
    }

    return mapCommentRow(data as CommentRow)
  },

  async addCommentLike({
    commentId,
    lectureSessionId,
    participantId,
  }: {
    commentId: string
    lectureSessionId: string
    participantId: string
  }) {
    await ensureAnonymousAuthSession()

    const { error } = await supabase.from('comment_likes').insert({
      comment_id: commentId,
      lecture_session_id: lectureSessionId,
      participant_id: participantId,
    })

    if (error && error.code !== '23505') {
      throw new Error(error.message)
    }

    return { alreadyLiked: error?.code === '23505' }
  },
}
