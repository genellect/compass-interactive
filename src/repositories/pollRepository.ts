import type { Poll, PollResponse, PollStatus } from '../types'

export type PollRepository = {
  listPolls: (polls: Poll[]) => Poll[]
  listOpenPolls: (polls: Poll[]) => Poll[]
  submitResponse: (input: {
    optionIds: string[]
    participantId: string
    pollId: string
    pollResponses: PollResponse[]
    polls: Poll[]
  }) => PollResponse[]
  setStatus: (input: {
    pollId: string
    polls: Poll[]
    status: PollStatus
  }) => Poll[]
}
