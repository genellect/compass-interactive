import type { LiveComment } from '../types'

export type CommentRepository = {
  listVisibleComments: (comments: LiveComment[]) => LiveComment[]
  createComment: (input: {
    body: string
    comments: LiveComment[]
    lectureId: string
    nickname?: string | null
    participantId: string
  }) => LiveComment[]
  toggleLike: (input: {
    commentId: string
    comments: LiveComment[]
    participantId: string
  }) => LiveComment[]
  toggleVisibility: (input: {
    commentId: string
    comments: LiveComment[]
  }) => LiveComment[]
  togglePinned: (input: {
    commentId: string
    comments: LiveComment[]
  }) => LiveComment[]
}
