import { getOrCreateLocalParticipantKey } from '../lib/participantIdentity'
import { supabase } from '../lib/supabaseClient'
import type { Poll } from '../types'

export type PollResultSummary = {
  optionId: string
  pollId: string
  responseCount: number
}

export type RealtimePollResultStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'unavailable'

type PollRow = {
  id: string
  lecture_session_id: string
  question: string
  type: 'single' | 'multiple'
  status: 'draft' | 'open' | 'closed'
  created_at: string
}

type PollOptionRow = {
  id: string
  poll_id: string
  label: string
  display_order: number
}

type PollResultRow = {
  option_id: string
  poll_id: string
  response_count: number
}

type PollResultRefreshEventRow = {
  created_at: string
  lecture_session_id: string
  poll_id: string
}

function mapPollRow(row: PollRow, optionRows: PollOptionRow[]): Poll {
  return {
    id: row.id,
    lectureId: row.lecture_session_id,
    question: row.question,
    type: row.type,
    status: row.status,
    createdAt: row.created_at,
    options: optionRows.map((option) => ({
      id: option.id,
      pollId: option.poll_id,
      label: option.label,
      order: option.display_order,
    })),
  }
}

export const supabasePollRepository = {
  async listOpenPolls(lectureSessionId: string): Promise<Poll[]> {
    const { data: pollRows, error: pollsError } = await supabase
      .from('polls')
      .select('id, lecture_session_id, question, type, status, created_at')
      .eq('lecture_session_id', lectureSessionId)
      .eq('status', 'open')
      .order('created_at', { ascending: true })

    if (pollsError) {
      throw new Error(pollsError.message)
    }

    const polls = (pollRows ?? []) as PollRow[]
    if (polls.length === 0) {
      return []
    }

    const pollIds = polls.map((poll) => poll.id)
    const { data: optionRows, error: optionsError } = await supabase
      .from('poll_options')
      .select('id, poll_id, label, display_order')
      .eq('lecture_session_id', lectureSessionId)
      .in('poll_id', pollIds)
      .order('display_order', { ascending: true })

    if (optionsError) {
      throw new Error(optionsError.message)
    }

    const optionsByPoll = new Map<string, PollOptionRow[]>()
    for (const option of (optionRows ?? []) as PollOptionRow[]) {
      const options = optionsByPoll.get(option.poll_id) ?? []
      options.push(option)
      optionsByPoll.set(option.poll_id, options)
    }

    return polls.map((poll) => mapPollRow(poll, optionsByPoll.get(poll.id) ?? []))
  },

  async listOpenPollResults(
    lectureSessionId: string,
  ): Promise<PollResultSummary[]> {
    const { data, error } = await supabase.rpc('get_open_poll_results', {
      target_lecture_session_id: lectureSessionId,
    })

    if (error) {
      throw new Error(error.message)
    }

    return ((data ?? []) as PollResultRow[]).map((row) => ({
      optionId: row.option_id,
      pollId: row.poll_id,
      responseCount: Number(row.response_count),
    }))
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

  async submitPollResponse({
    lectureSessionId,
    optionIds,
    participantId,
    pollId,
  }: {
    lectureSessionId: string
    optionIds: string[]
    participantId: string
    pollId: string
  }) {
    await this.ensureAnonymousParticipant({ lectureSessionId, participantId })

    const { error } = await supabase.from('poll_responses').insert({
      lecture_session_id: lectureSessionId,
      option_ids: optionIds,
      participant_id: participantId,
      poll_id: pollId,
    })

    if (error && error.code !== '23505') {
      throw new Error(error.message)
    }

    return { alreadyAnswered: error?.code === '23505' }
  },

  subscribeToPollResultRefreshEvents({
    lectureSessionId,
    onRefresh,
    onStatusChange,
  }: {
    lectureSessionId: string
    onRefresh: (event: PollResultRefreshEventRow) => void
    onStatusChange?: (status: RealtimePollResultStatus) => void
  }) {
    onStatusChange?.('connecting')

    const channel = supabase
      .channel(`poll-result-refresh:${lectureSessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          filter: `lecture_session_id=eq.${lectureSessionId}`,
          schema: 'public',
          table: 'poll_result_refresh_events',
        },
        (payload) => {
          const nextEvent = payload.new as PollResultRefreshEventRow | null

          if (!nextEvent) {
            return
          }

          onRefresh(nextEvent)
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          onStatusChange?.('connected')
          return
        }

        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          onStatusChange?.('unavailable')
          return
        }

        if (status === 'CLOSED') {
          onStatusChange?.('disconnected')
        }
      })

    return () => {
      void supabase.removeChannel(channel)
      onStatusChange?.('disconnected')
    }
  },
}
