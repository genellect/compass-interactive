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
  PublicAcademicAnswer,
  PublicLectureSummary,
  PublicMaterialSummary,
} from '../repositories/supabaseLiveStateRepository'
import type { LectureArchiveSession } from '../types/archive'

export type JoinResult =
  | {
      destination: 'archive' | 'lecture'
      ok: true
      participantId: string | null
    }
  | { ok: false; message: string }

export type SessionSyncPauseReason = 'hidden' | 'idle' | 'lectureClosed' | null

export type OperatorLiveAccess =
  { kind: 'admin'; token: string } | { kind: 'display'; token: string }

export type CompassStateValue = {
  academicAnswers: PublicAcademicAnswer[]
  caption: PublicCaption | null
  summaries: PublicLectureSummary[]
  materialSummary: PublicMaterialSummary | null
  archiveSession: LectureArchiveSession | null
  lecture: LectureSession
  participants: Participant[]
  participantCount: number
  visibleCommentCount: number
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
  isArchiveResumePending: boolean
  archiveResumeError: string | null
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
  lastSuccessfulSyncAt: number | null
  getServerNow: () => string | null
  resumeSessionSync: () => Promise<void>
  resetDemoLecture: () => void
  retryArchiveResume: () => void
  clearSelectedLectureSession: () => void
  leaveLecture: () => void
  setOperatorLiveAccess: (access: OperatorLiveAccess | null) => void
  selectLectureSession: (lecture: JoinedLectureSession) => void
  sessionSyncMessage: string | null
  sessionSyncPauseReason: SessionSyncPauseReason
  joinLecture: (lectureCode: string) => Promise<JoinResult>
  addComment: (body: string, nickname?: string | null) => Promise<boolean>
  refreshComments: () => Promise<void>
  refreshDisplayState: () => Promise<void>
  loadOlderComments: () => Promise<void>
  refreshPollResults: () => Promise<void>
  toggleCommentLike: (commentId: string) => Promise<void>
  toggleCommentVisibility: (commentId: string) => void
  toggleCommentPinned: (commentId: string) => void
  submitPollResponse: (pollId: string, optionIds: string[]) => Promise<void>
}

export const CompassStateContext = createContext<CompassStateValue | null>(null)
