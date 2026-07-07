export type LectureStatus = 'draft' | 'open' | 'closed'

export type LectureSession = {
  id: string
  title: string
  codeLabel: string
  codeHash: string
  status: LectureStatus
  expectedParticipants: number
  createdAt: string
  startsAt?: string
  expiresAt?: string
  feedbackFormUrl?: string
}
