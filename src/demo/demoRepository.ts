import {
  DEMO_LECTURE_ID,
  demoAmbientComments,
  demoDisplayState,
  demoLecture,
  demoPolls,
  demoSeedPollResults,
} from './demoSeedData.ts'
import {
  loadDemoState,
  resetDemoState,
  saveDemoState,
  subscribeToDemoState,
  type DemoLectureState,
  type DemoStorage,
} from './demoStorage.ts'
import type { JoinedLectureSession } from '../lib/joinedLecture.ts'
import type { PollResultSummary } from '../repositories/supabasePollRepository.ts'
import type { Participant } from '../types/index.ts'
import { normalizeCommentNickname } from '../lib/commentNickname.ts'

export type DemoSnapshot = {
  comments: DemoLectureState['comments']
  displayState: typeof demoDisplayState
  lecture: typeof demoLecture
  participant: Participant
  pollResponses: DemoLectureState['pollResponses']
  pollResults: PollResultSummary[]
  polls: typeof demoPolls
  session: JoinedLectureSession
}

function updateDemoState(
  update: (current: DemoLectureState) => DemoLectureState,
  storage?: DemoStorage,
) {
  const current = loadDemoState(storage)
  const next = update(current)
  next.updatedAt = new Date().toISOString()
  return saveDemoState(next, storage)
}

function toSnapshot(state: DemoLectureState): DemoSnapshot {
  const localCounts = new Map<string, number>()

  for (const response of state.pollResponses) {
    for (const optionId of response.optionIds) {
      localCounts.set(optionId, (localCounts.get(optionId) ?? 0) + 1)
    }
  }

  return {
    comments: state.comments,
    displayState: demoDisplayState,
    lecture: demoLecture,
    participant: {
      id: state.participantId,
      lectureId: DEMO_LECTURE_ID,
      joinedAt: state.createdAt,
      lastSeenAt: state.updatedAt,
    },
    pollResponses: state.pollResponses,
    pollResults: demoSeedPollResults.map((result) => ({
      ...result,
      responseCount:
        result.responseCount + (localCounts.get(result.optionId) ?? 0),
    })),
    polls: demoPolls,
    session: {
      id: DEMO_LECTURE_ID,
      runtimeMode: 'demo',
      status: 'open',
      title: demoLecture.title,
    },
  }
}

export const demoRepository = {
  getSnapshot(storage?: DemoStorage) {
    return toSnapshot(loadDemoState(storage))
  },

  addComment(
    body: string,
    nickname?: string | null,
    storage?: DemoStorage,
  ) {
    const trimmedBody = body.trim().slice(0, 120)
    if (!trimmedBody) {
      throw new Error('コメントを入力してください。')
    }

    const state = updateDemoState(
      (current) => ({
        ...current,
        comments: [
          {
            id: crypto.randomUUID(),
            lectureId: DEMO_LECTURE_ID,
            participantId: current.participantId,
            nickname: normalizeCommentNickname(nickname),
            body: trimmedBody,
            likeCount: 0,
            likedByParticipantIds: [],
            status: 'visible',
            isPinned: false,
            createdAt: new Date().toISOString(),
          },
          ...current.comments,
        ],
      }),
      storage,
    )

    return toSnapshot(state)
  },

  addNextAmbientComment(storage?: DemoStorage) {
    const current = loadDemoState(storage)
    const existingIds = new Set(current.comments.map((comment) => comment.id))
    const nextComment = demoAmbientComments.find(
      (comment) => !existingIds.has(comment.id),
    )
    if (!nextComment) return toSnapshot(current)
    const state = updateDemoState(
      (stateBeforeInsert) => ({
        ...stateBeforeInsert,
        comments: [
          { ...nextComment, createdAt: new Date().toISOString() },
          ...stateBeforeInsert.comments,
        ],
      }),
      storage,
    )
    return toSnapshot(state)
  },

  addCommentLike(commentId: string, storage?: DemoStorage) {
    const state = updateDemoState(
      (current) => ({
        ...current,
        comments: current.comments.map((comment) => {
          if (
            comment.id !== commentId ||
            comment.likedByParticipantIds.includes(current.participantId)
          ) {
            return comment
          }

          return {
            ...comment,
            likeCount: comment.likeCount + 1,
            likedByParticipantIds: [
              ...comment.likedByParticipantIds,
              current.participantId,
            ],
          }
        }),
      }),
      storage,
    )

    return toSnapshot(state)
  },

  submitPollResponse(
    pollId: string,
    optionIds: string[],
    storage?: DemoStorage,
  ) {
    const poll = demoPolls.find((item) => item.id === pollId)
    if (!poll || poll.status !== 'open') {
      throw new Error('この投票には現在回答できません。')
    }

    const validOptionIds = new Set(poll.options.map((option) => option.id))
    const normalizedOptionIds = Array.from(new Set(optionIds)).filter((id) =>
      validOptionIds.has(id),
    )
    const selectedOptionIds =
      poll.type === 'single'
        ? normalizedOptionIds.slice(0, 1)
        : normalizedOptionIds

    if (selectedOptionIds.length === 0) {
      throw new Error('選択肢を選んでください。')
    }

    const state = updateDemoState((current) => {
      if (
        current.pollResponses.some(
          (response) =>
            response.pollId === pollId &&
            response.participantId === current.participantId,
        )
      ) {
        throw new Error('この投票には回答済みです。')
      }

      return {
        ...current,
        pollResponses: [
          ...current.pollResponses,
          {
            id: crypto.randomUUID(),
            pollId,
            participantId: current.participantId,
            optionIds: selectedOptionIds,
            createdAt: new Date().toISOString(),
          },
        ],
      }
    }, storage)

    return toSnapshot(state)
  },

  reset(storage?: DemoStorage) {
    return toSnapshot(resetDemoState(storage))
  },

  subscribe(onChange: () => void) {
    return subscribeToDemoState(onChange)
  },
}
