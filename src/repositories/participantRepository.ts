import type { LectureSession, Participant } from '../types'

export type JoinLectureResult =
  | { ok: true; participantId: string; participants: Participant[] }
  | { ok: false; message: string }

export type ParticipantRepository = {
  restoreParticipantId: () => string | null
  persistParticipantId: (participantId: string) => void
  joinLecture: (input: {
    lecture: LectureSession
    lectureCode: string
    participants: Participant[]
    currentParticipantId: string | null
  }) => JoinLectureResult
}
