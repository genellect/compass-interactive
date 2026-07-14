import type { LiveComment } from '../types'

function sortCommentsNewestFirst(comments: LiveComment[]) {
  return [...comments].sort((left, right) => {
    const createdAtComparison = right.createdAt.localeCompare(left.createdAt)
    return createdAtComparison || right.id.localeCompare(left.id)
  })
}

export function createOptimisticComment({
  body,
  createdAt = new Date().toISOString(),
  id = `optimistic-${crypto.randomUUID()}`,
  lectureId,
  participantId,
}: {
  body: string
  createdAt?: string
  id?: string
  lectureId: string
  participantId: string
}): LiveComment {
  return {
    body: body.trim().slice(0, 120),
    createdAt,
    id,
    isPending: true,
    isPinned: false,
    lectureId,
    likeCount: 0,
    likedByParticipantIds: [],
    participantId,
    status: 'visible',
  }
}

export function mergeInitialCommentsWithPending(
  currentComments: LiveComment[],
  serverComments: LiveComment[],
) {
  return sortCommentsNewestFirst([
    ...currentComments.filter((comment) => comment.isPending),
    ...serverComments,
  ])
}

export function settleOptimisticComment(
  currentComments: LiveComment[],
  optimisticId: string,
  savedComment: LiveComment,
) {
  return sortCommentsNewestFirst([
    savedComment,
    ...currentComments.filter(
      (comment) => comment.id !== optimisticId && comment.id !== savedComment.id,
    ),
  ])
}

export function rollbackOptimisticComment(
  currentComments: LiveComment[],
  optimisticId: string,
) {
  return currentComments.filter((comment) => comment.id !== optimisticId)
}
