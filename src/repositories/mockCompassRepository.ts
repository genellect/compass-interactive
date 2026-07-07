import { MOCK_LECTURE_CODE, mockLectureSession } from '../lib/mockData'
import {
  createParticipantId,
  isParticipantUuid,
  persistLocalParticipantIdentity,
  restoreLocalParticipantId,
} from '../lib/participantIdentity'
import {
  createOrUpdateParticipant,
  listOpenPolls,
  listVisibleComments,
  moderateCommentVisibility,
  setPollStatus,
  submitComment,
  submitPollResponse,
  toggleCommentLike,
  toggleCommentPin,
  validateLectureCode,
} from '../services/compassActions'
import type { CommentRepository } from './commentRepository'
import type { LectureRepository } from './lectureRepository'
import type { ParticipantRepository } from './participantRepository'
import type { PollRepository } from './pollRepository'

const lectureRepository: LectureRepository = {
  getLectureSession: () => mockLectureSession,
  getExpectedLectureCode: () => MOCK_LECTURE_CODE,
  validateLectureCode: (lectureCode) =>
    validateLectureCode(lectureCode, MOCK_LECTURE_CODE),
}

const participantRepository: ParticipantRepository = {
  restoreParticipantId: restoreLocalParticipantId,
  persistParticipantId: (participantId) => {
    persistLocalParticipantIdentity(participantId)
  },
  joinLecture: ({ currentParticipantId, lecture, lectureCode, participants }) => {
    if (!lectureRepository.validateLectureCode(lectureCode)) {
      return { ok: false, message: '講義コードが正しくありません。' }
    }

    const participantId = isParticipantUuid(currentParticipantId)
      ? currentParticipantId
      : createParticipantId()
    participantRepository.persistParticipantId(participantId)

    return {
      ok: true,
      ...createOrUpdateParticipant({
        lecture,
        participants,
        participantId,
      }),
    }
  },
}

const commentRepository: CommentRepository = {
  listVisibleComments,
  createComment: submitComment,
  toggleLike: toggleCommentLike,
  toggleVisibility: moderateCommentVisibility,
  togglePinned: toggleCommentPin,
}

const pollRepository: PollRepository = {
  listPolls: (polls) => polls,
  listOpenPolls,
  submitResponse: submitPollResponse,
  setStatus: setPollStatus,
}

export const mockCompassRepository = {
  lecture: lectureRepository,
  participant: participantRepository,
  comment: commentRepository,
  poll: pollRepository,
}
