export type LiveCommentStatus = 'visible' | 'hidden'

export type LiveComment = {
  id: string
  lectureId: string
  participantId: string
  body: string
  likeCount: number
  likedByParticipantIds: string[]
  status: LiveCommentStatus
  isPinned: boolean
  isPending?: boolean
  createdAt: string
}
