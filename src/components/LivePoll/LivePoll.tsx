import type { Poll, PollResponse } from '../../types'
import type { PollResultSummary } from '../../repositories/supabasePollRepository'
import { PollCard } from './PollCard'

type LivePollProps = {
  currentParticipantId?: string | null
  displayMode?: boolean
  onSubmitResponse?: (pollId: string, optionIds: string[]) => void | Promise<void>
  poll: Poll
  results?: PollResultSummary[]
  responses: PollResponse[]
}

export function LivePoll(props: LivePollProps) {
  return <PollCard {...props} />
}
