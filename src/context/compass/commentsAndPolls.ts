import type {
  CommentCursor,
  CommentLikeTotal,
} from '../../repositories/supabaseLiveStateRepository'
import type { LiveComment, PollResponse } from '../../types'

export function mergeLocalPollResponse({
  currentResponses,
  optionIds,
  participantId,
  pollId,
}: {
  currentResponses: PollResponse[]
  optionIds: string[]
  participantId: string
  pollId: string
}) {
  const nextResponse: PollResponse = {
    id: `local-response-${pollId}-${participantId}`,
    pollId,
    participantId,
    optionIds,
    createdAt: new Date().toISOString(),
  }
  return [
    ...currentResponses.filter(
      (response) =>
        !(
          response.pollId === pollId && response.participantId === participantId
        ),
    ),
    nextResponse,
  ]
}

export function mergeVisibleComment(
  currentComments: LiveComment[],
  nextComment: LiveComment,
) {
  if (
    nextComment.status !== 'visible' ||
    currentComments.some((comment) => comment.id === nextComment.id)
  )
    return currentComments
  return [nextComment, ...currentComments].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

export function applyCommentLikeTotals(
  currentComments: LiveComment[],
  totals: CommentLikeTotal[],
  participantId: string | null,
  likedCommentIds: ReadonlySet<string>,
) {
  const totalsByComment = new Map(
    totals.map((total) => [total.commentId, total] as const),
  )
  return currentComments.map((comment) => {
    const total = totalsByComment.get(comment.id)
    return {
      ...comment,
      likeCount: total?.likeCount ?? 0,
      likedByParticipantIds:
        participantId &&
        (likedCommentIds.has(comment.id) || total?.likedByParticipant)
          ? [participantId]
          : [],
    }
  })
}

export function applyParticipantCommentState(
  currentComments: LiveComment[],
  participantId: string,
  likedCommentIds: ReadonlySet<string>,
) {
  return currentComments.map((comment) => ({
    ...comment,
    likedByParticipantIds: likedCommentIds.has(comment.id)
      ? [participantId]
      : [],
  }))
}

export function getNewestCommentCursor(
  comments: LiveComment[],
  currentCursor: CommentCursor | null,
) {
  return comments.reduce<CommentCursor | null>((latest, comment) => {
    const candidate = { createdAt: comment.createdAt, id: comment.id }
    if (!latest) return candidate
    const createdAtComparison = candidate.createdAt.localeCompare(
      latest.createdAt,
    )
    return createdAtComparison > 0 ||
      (createdAtComparison === 0 && candidate.id.localeCompare(latest.id) > 0)
      ? candidate
      : latest
  }, currentCursor)
}

export function getOldestCommentCursor(comments: LiveComment[]) {
  return comments.reduce<CommentCursor | null>((oldest, comment) => {
    if (comment.isPending) return oldest
    const candidate = { createdAt: comment.createdAt, id: comment.id }
    if (!oldest) return candidate
    const createdAtComparison = candidate.createdAt.localeCompare(
      oldest.createdAt,
    )
    return createdAtComparison < 0 ||
      (createdAtComparison === 0 && candidate.id.localeCompare(oldest.id) < 0)
      ? candidate
      : oldest
  }, null)
}

export function mergeLocalCommentLike(
  currentComments: LiveComment[],
  commentId: string,
  participantId: string,
) {
  return currentComments.map((comment) => {
    if (
      comment.id !== commentId ||
      comment.status !== 'visible' ||
      comment.likedByParticipantIds.includes(participantId)
    )
      return comment
    return {
      ...comment,
      likedByParticipantIds: [...comment.likedByParticipantIds, participantId],
      likeCount: comment.likeCount + 1,
    }
  })
}
