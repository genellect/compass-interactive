import { createContext } from 'react'
import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
  PollStatus,
} from '../types'
import type { RealtimeCommentStatus } from '../repositories/supabaseCommentRepository'
import type {
  PollResultSummary,
  RealtimePollResultStatus,
} from '../repositories/supabasePollRepository'

export type JoinResult =
  | { ok: true; participantId: string }
  | { ok: false; message: string }

export type CompassStateValue = {
  lecture: LectureSession
  participants: Participant[]
  comments: LiveComment[]
  visibleComments: LiveComment[]
  hiddenCommentCount: number
  polls: Poll[]
  openPolls: Poll[]
  pollResponses: PollResponse[]
  pollResults: PollResultSummary[]
  currentParticipantId: string | null
  activeLectureSessionId: string | null
  hasJoinedLectureSession: boolean
  expectedLectureCode: string
  commentsLoading: boolean
  commentsError: string | null
  commentLikesError: string | null
  pollsError: string | null
  pollResultsError: string | null
  pollsLoading: boolean
  isSubmittingComment: boolean
  realtimeCommentsStatus: RealtimeCommentStatus
  realtimeCommentLikesStatus: RealtimeCommentStatus
  realtimePollResultsStatus: RealtimePollResultStatus
  joinLecture: (lectureCode: string) => Promise<JoinResult>
  addComment: (body: string) => Promise<boolean>
  refreshComments: () => Promise<void>
  refreshPollResults: () => Promise<void>
  toggleCommentLike: (commentId: string) => Promise<void>
  toggleCommentVisibility: (commentId: string) => void
  toggleCommentPinned: (commentId: string) => void
  setPollStatus: (pollId: string, status: PollStatus) => void
  submitPollResponse: (pollId: string, optionIds: string[]) => Promise<void>
}

export const CompassStateContext = createContext<CompassStateValue | null>(null)
