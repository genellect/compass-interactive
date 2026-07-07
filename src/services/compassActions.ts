import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
  PollStatus,
} from '../types'
export { createParticipantId } from '../lib/participantIdentity'

export type JoinLectureInput = {
  lecture: LectureSession
  participants: Participant[]
  participantId: string
}

export type JoinLectureOutput = {
  participants: Participant[]
  participantId: string
}

export function validateLectureCode(inputCode: string, expectedCode: string) {
  return inputCode.trim().toUpperCase() === expectedCode.trim().toUpperCase()
}

export function createOrUpdateParticipant({
  lecture,
  participants,
  participantId,
}: JoinLectureInput): JoinLectureOutput {
  const now = new Date().toISOString()
  const exists = participants.some((participant) => participant.id === participantId)

  if (exists) {
    return {
      participantId,
      participants: participants.map((participant) =>
        participant.id === participantId
          ? { ...participant, lastSeenAt: now }
          : participant,
      ),
    }
  }

  return {
    participantId,
    participants: [
      ...participants,
      {
        id: participantId,
        lectureId: lecture.id,
        joinedAt: now,
        lastSeenAt: now,
      },
    ],
  }
}

export function listVisibleComments(comments: LiveComment[]) {
  return comments.filter((comment) => comment.status === 'visible')
}

export function submitComment({
  body,
  comments,
  lectureId,
  participantId,
}: {
  body: string
  comments: LiveComment[]
  lectureId: string
  participantId: string
}) {
  const trimmedBody = body.trim().slice(0, 120)
  if (!trimmedBody) {
    return comments
  }

  // comment投稿処理: Phase 1.5ではDBへ送らず、React stateへ即時追加する。
  const newComment: LiveComment = {
    id: `comment-${Date.now()}`,
    lectureId,
    participantId,
    body: trimmedBody,
    likeCount: 0,
    likedByParticipantIds: [],
    status: 'visible',
    isPinned: false,
    createdAt: new Date().toISOString(),
  }

  return [newComment, ...comments]
}

export function toggleCommentLike({
  commentId,
  comments,
  participantId,
}: {
  commentId: string
  comments: LiveComment[]
  participantId: string
}) {
  // like toggle処理: 同じparticipantは1回だけ。再クリックで取り消す。
  return comments.map((comment) => {
    if (comment.id !== commentId) {
      return comment
    }

    const alreadyLiked = comment.likedByParticipantIds.includes(participantId)
    const likedByParticipantIds = alreadyLiked
      ? comment.likedByParticipantIds.filter((id) => id !== participantId)
      : [...comment.likedByParticipantIds, participantId]

    return {
      ...comment,
      likedByParticipantIds,
      likeCount: Math.max(0, comment.likeCount + (alreadyLiked ? -1 : 1)),
    }
  })
}

export function moderateCommentVisibility({
  commentId,
  comments,
}: {
  commentId: string
  comments: LiveComment[]
}): LiveComment[] {
  // adminによるhidden切り替え: 学生・投影画面からはhiddenを除外する。
  return comments.map((comment) =>
    comment.id === commentId
      ? {
          ...comment,
          status: comment.status === 'visible' ? 'hidden' : 'visible',
        }
      : comment,
  )
}

export function toggleCommentPin({
  commentId,
  comments,
}: {
  commentId: string
  comments: LiveComment[]
}) {
  return comments.map((comment) =>
    comment.id === commentId
      ? { ...comment, isPinned: !comment.isPinned }
      : comment,
  )
}

export function listOpenPolls(polls: Poll[]) {
  return polls.filter((poll) => poll.status === 'open')
}

export function setPollStatus({
  pollId,
  polls,
  status,
}: {
  pollId: string
  polls: Poll[]
  status: PollStatus
}) {
  // adminによるpoll open/close: Phase 1.5では状態だけを切り替える。
  return polls.map((poll) => (poll.id === pollId ? { ...poll, status } : poll))
}

export function submitPollResponse({
  optionIds,
  participantId,
  pollId,
  pollResponses,
  polls,
}: {
  optionIds: string[]
  participantId: string
  pollId: string
  pollResponses: PollResponse[]
  polls: Poll[]
}) {
  if (optionIds.length === 0) {
    return pollResponses
  }

  const poll = polls.find((item) => item.id === pollId)
  if (!poll || poll.status !== 'open') {
    return pollResponses
  }

  const normalizedOptionIds =
    poll.type === 'single' ? optionIds.slice(0, 1) : optionIds

  // poll回答処理: 同じparticipantの同じpoll回答は置き換える。
  const newResponse: PollResponse = {
    id: `response-${pollId}-${participantId}`,
    pollId,
    participantId,
    optionIds: normalizedOptionIds,
    createdAt: new Date().toISOString(),
  }

  return [
    ...pollResponses.filter(
      (response) =>
        !(response.pollId === pollId && response.participantId === participantId),
    ),
    newResponse,
  ]
}
