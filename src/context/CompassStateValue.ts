import { createContext } from 'react'
import type {
  LectureSession,
  LiveComment,
  Participant,
  Poll,
  PollResponse,
  LectureRuntimeMode,
} from '../types'
import type { PollResultSummary } from '../repositories/supabasePollRepository'
import type { JoinedLectureSession } from '../lib/joinedLecture'
import type { DisplayState } from '../repositories/supabaseDisplayStateRepository'
import type {
  PublicCaption,
  PublicLectureSummary,
} from '../repositories/supabaseLiveStateRepository'

export type JoinResult =
  { ok: true; participantId: string } | { ok: false; message: string }

export type SessionSyncPauseReason = 'hidden' | 'idle' | 'lectureClosed' | null

export type CompassStateValue = {
  caption: PublicCaption | null
  summaries: PublicLectureSummary[]
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
  runtimeMode: LectureRuntimeMode
  expectedLectureCode: string
  commentsLoading: boolean
  hasOlderComments: boolean
  isLoadingOlderComments: boolean
  commentsError: string | null
  commentLikesError: string | null
  pollsError: string | null
  pollResultsError: string | null
  pollsLoading: boolean
  displayState: DisplayState | null
  displayStateError: string | null
  isSubmittingComment: boolean
  isSessionSyncPaused: boolean
  lastActivityAt: number
  getServerNow: () => string | null
  resumeSessionSync: () => Promise<void>
  resetDemoLecture: () => void
  selectLectureSession: (lecture: JoinedLectureSession) => void
  sessionSyncMessage: string | null
  sessionSyncPauseReason: SessionSyncPauseReason
  joinLecture: (lectureCode: string) => Promise<JoinResult>
  addComment: (body: string) => Promise<boolean>
  refreshComments: () => Promise<void>
  loadOlderComments: () => Promise<void>
  refreshPollResults: () => Promise<void>
  toggleCommentLike: (commentId: string) => Promise<void>
  toggleCommentVisibility: (commentId: string) => void
  toggleCommentPinned: (commentId: string) => void
  submitPollResponse: (pollId: string, optionIds: string[]) => Promise<void>
}

export const CompassStateContext = createContext<CompassStateValue | null>(null)
