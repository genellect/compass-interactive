export type PollType = 'single' | 'multiple'
export type PollStatus = 'draft' | 'open' | 'closed'

export type PollOption = {
  id: string
  pollId: string
  label: string
  order: number
}

export type Poll = {
  id: string
  lectureId: string
  question: string
  type: PollType
  status: PollStatus
  options: PollOption[]
  createdAt: string
}

export type PollResponse = {
  id: string
  pollId: string
  participantId: string
  optionIds: string[]
  createdAt: string
}
