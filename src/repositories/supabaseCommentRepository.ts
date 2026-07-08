import { supabase } from '../lib/supabaseClient'
import { getOrCreateLocalParticipantKey } from '../lib/participantIdentity'
import type { LiveComment } from '../types'

type CommentRow = {
  id: string
  lecture_session_id: string
  participant_id: string
  body: string
  status: 'visible' | 'hidden' | 'deleted'
  is_pinned: boolean
  created_at: string
  updated_at: string
}

export type CommentLikeRow = {
  comment_id: string
  lecture_session_id: string
  participant_id: string
}

export type RealtimeCommentStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'unavailable'

function mapCommentRow(row: CommentRow): LiveComment {
  return {
    id: row.id,
    lectureId: row.lecture_session_id,
    participantId: row.participant_id,
    body: row.body,
    likeCount: 0,
    likedByParticipantIds: [],
    status: row.status === 'hidden' ? 'hidden' : 'visible',
    isPinned: row.is_pinned,
    createdAt: row.created_at,
  }
}

function isVisibleCommentRow(row: CommentRow) {
  return row.status === 'visible'
}

export const supabaseCommentRepository = {
  async listVisibleComments(lectureSessionId: string): Promise<LiveComment[]> {
    const { data, error } = await supabase
      .from('comments')
      .select(
        'id, lecture_session_id, participant_id, body, status, is_pinned, created_at, updated_at',
      )
      .eq('lecture_session_id', lectureSessionId)
      .eq('status', 'visible')
      .order('created_at', { ascending: false })

    if (error) {
      throw new Error(error.message)
    }

    return (data ?? []).map((row) => mapCommentRow(row as CommentRow))
  },

  async listCommentLikesForVisibleComments(
    lectureSessionId: string,
  ): Promise<CommentLikeRow[]> {
    const { data, error } = await supabase
      .from('comment_likes')
      .select('comment_id, lecture_session_id, participant_id')
      .eq('lecture_session_id', lectureSessionId)

    if (error) {
      throw new Error(error.message)
    }

    return (data ?? []).map((row) => row as CommentLikeRow)
  },

  subscribeToVisibleCommentInserts({
    lectureSessionId,
    onComment,
    onStatusChange,
  }: {
    lectureSessionId: string
    onComment: (comment: LiveComment) => void
    onStatusChange?: (status: RealtimeCommentStatus) => void
  }) {
    onStatusChange?.('connecting')

    const channel = supabase
      .channel(`comments-inserts:${lectureSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          filter: `lecture_session_id=eq.${lectureSessionId}`,
          schema: 'public',
          table: 'comments',
        },
        (payload) => {
          const row = payload.new as CommentRow

          if (!isVisibleCommentRow(row)) {
            return
          }

          onComment(mapCommentRow(row))
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onStatusChange?.('connected')
          return
        }

        if (
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT' ||
          status === 'CLOSED'
        ) {
          onStatusChange?.('disconnected')
        }
      })

    return () => {
      onStatusChange?.('disconnected')
      void supabase.removeChannel(channel)
    }
  },

  async ensureAnonymousParticipant({
    lectureSessionId,
    participantId,
  }: {
    lectureSessionId: string
    participantId: string
  }) {
    const participantKey = getOrCreateLocalParticipantKey(
      participantId,
      lectureSessionId,
    )
    const { error } = await supabase.from('participants').insert({
      id: participantId,
      lecture_session_id: lectureSessionId,
      participant_key: participantKey,
      last_seen_at: new Date().toISOString(),
    })

    if (error && error.code !== '23505') {
      throw new Error(error.message)
    }
  },

  async createVisibleComment({
    body,
    lectureSessionId,
    participantId,
  }: {
    body: string
    lectureSessionId: string
    participantId: string
  }): Promise<LiveComment> {
    const trimmedBody = body.trim().slice(0, 120)
    if (!trimmedBody) {
      throw new Error('コメントを入力してください。')
    }

    await this.ensureAnonymousParticipant({ lectureSessionId, participantId })

    const { data, error } = await supabase
      .from('comments')
      .insert({
        lecture_session_id: lectureSessionId,
        participant_id: participantId,
        body: trimmedBody,
        status: 'visible',
        is_pinned: false,
      })
      .select(
        'id, lecture_session_id, participant_id, body, status, is_pinned, created_at, updated_at',
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
    await this.ensureAnonymousParticipant({ lectureSessionId, participantId })

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
