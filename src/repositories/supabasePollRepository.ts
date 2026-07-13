import { supabase } from '../lib/supabaseClient'
import { ensureAnonymousAuthSession } from '../lib/anonymousAuth'

export type PollResultSummary = {
  optionId: string
  pollId: string
  responseCount: number
}

export const supabasePollRepository = {
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
    await ensureAnonymousAuthSession()

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
}
