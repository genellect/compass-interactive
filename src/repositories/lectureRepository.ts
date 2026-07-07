import type { LectureSession } from '../types'

export type LectureRepository = {
  getLectureSession: () => LectureSession
  getExpectedLectureCode: () => string
  validateLectureCode: (lectureCode: string) => boolean
}
